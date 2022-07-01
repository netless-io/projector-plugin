import type { SyncEvent} from "@netless/slide";
import { Slide, SLIDE_EVENTS, waitUntil } from "@netless/slide";
import type { Displayer, DisplayerState, Room} from "white-web-sdk";
import {  isRoom as _isRoom } from "white-web-sdk";
import { ProjectorDisplayer } from "./projectorDisplayer";
import { ProjectorPlugin } from "./projectorPlugin";

type EventPayload = {
    type: string,
    payload: SyncEvent,
}

export type SlideState = {
    taskId: string,
    url: string,
    currentSlideIndex: number,
}
const isRoom = _isRoom as (displayer: Displayer) => displayer is Room;

export class ProjectorSlideManager {

    private _slideState: any;  // 不需要读取 slideState 中的内容，也不需要监听变化，只存储，在恢复页面的时候读取状态
    private context: ProjectorPlugin;
    public slide: Slide | undefined;
    public slideWidth: number | undefined;
    public slideHeight: number | undefined;

    // manager 创建后一定要有一个 slide 实例并且有 state 后，才会存入 store，从 store 读取的 manager 可以保证一定有 state
    constructor(context: ProjectorPlugin) {
        this.context = context;
    }

    private onStateChange = (state: any): void => {
        ProjectorPlugin.logger.info("[Projector plugin]: local state changed");
        if (isRoom(this.context.displayer) && (this.context.displayer as Room).isWritable) {
            this._slideState = state;
            this.context.setAttributes({[this._slideState.taskId]: this._slideState});
        }
    }

    private onSlideChange = (index: number): void => {
        ProjectorPlugin.logger.info(`[ProjecloadPPTByAttributestor plugin] slide change to ${index}`);
        console.log({...this.context.attributes}, {...this._slideState});
        if (isRoom(this.context.displayer) && (this.context.displayer as Room).isWritable) {
            const scenePath = `/${ProjectorPlugin.kind}/${this.slide?.slideState.taskId}/${index}`;
            
            ProjectorPlugin.logger.info(`[Projector plugin] scenePath change to ${scenePath}`);
            (this.context.displayer as Room).setScenePath(scenePath);
        }
    }
    private onSlideEventDispatch = (event: SyncEvent): void => {
        if (isRoom(this.context.displayer) && (this.context.displayer as Room).isWritable) {
            const payload: EventPayload = {
                type: SLIDE_EVENTS.syncDispatch,
                payload: event,
            };
            ProjectorPlugin.logger.info("[Projector plugin] dispatch: ", JSON.stringify(event));
            (this.context.displayer as Room).dispatchMagixEvent(SLIDE_EVENTS.syncDispatch, payload);
        }
    }

    private async setSlideAndWhiteboardSize(slide: Slide): Promise<void> {
        const [width, height] = await slide.getSizeAsync();
        this.alignWhiteboardAndSlide(width, height);
    }

    private alignWhiteboardAndSlide(slideWidth: number, slideHeight: number) {
        this.context.displayer.moveCamera({
            centerX: 0,
            centerY: 0,
            scale: 1,
        });
       
        // 调整白板至与 ppt 尺寸一致，并对准中心，同时占满整个页面
        this.context.displayer.moveCameraToContain({
            originX: 0,
            originY: 0,
            width: slideWidth,
            height: slideHeight,
        });
        this.context.displayer.moveCamera({
            centerX: 0,
            centerY: 0,
        });
    }

    public computedStyle(state: DisplayerState): void {
        if (ProjectorDisplayer.instance) {
            const {scale, centerX, centerY} = state.cameraState;
            // 由于 ppt 和白板中点已经对齐，这里缩放中心就是中点
            const transformOrigin = `center`;
            const x = - (centerX * scale);
            const y = - (centerY * scale);
            if (ProjectorDisplayer.instance?.containerRef) {
                ProjectorDisplayer.instance.containerRef.style.transformOrigin = transformOrigin;
                ProjectorDisplayer.instance.containerRef.style.transform = `translate(${x}px,${y}px) scale(1, 1)`;
                if (this.slideWidth && this.slideHeight) {
                    ProjectorDisplayer.instance.containerRef.style.width = `${this.slideWidth * scale}px`;
                    ProjectorDisplayer.instance.containerRef.style.height = `${this.slideHeight * scale}px`;
                }
            }
        }
    }

    private getSlideObj(): Slide {
        if (this.slide) {
            return this.slide;
        } else {
            throw new Error(`Projector plugin] can not find slide object`);
        }
    }

    public nextStep():void {
        this.slide?.nextStep();
    }

    public prevStep():void {
        this.slide?.prevStep();
    }

    public destory(): void {
        this.slide?.destroy();
        this.slide = undefined;
    }

    public renderSlide = async(index: number): Promise<void> => {
        console.log("call slide ernder");
        await this.setSlideAndWhiteboardSize(this.getSlideObj());
        this.getSlideObj().renderSlide(index);
    };

    public async getSlideCount(): Promise<number> {
        return await this.getSlideObj().getSlideCountAsync();
    }

    public initSlide = async(): Promise<Slide> => {
        return waitUntil(() => {
            return !!ProjectorDisplayer.instance && !!ProjectorDisplayer.instance!.containerRef;
        }, 10000).then(() => {
            if (this.slide) {
                return this.slide;
            }
            console.log("ProjectorDisplayer.instance ", ProjectorDisplayer.instance);
            
            const slide = new Slide({
                anchor: ProjectorDisplayer.instance!.containerRef!,
                interactive: true,
                mode: "interactive",    // 模式固定
                resize: true,
                // TODO navigatorDelegate 是否 setstate 也会触发？
            });
            slide.on(SLIDE_EVENTS.stateChange, this.onStateChange);
            slide.on(SLIDE_EVENTS.slideChange, this.onSlideChange);
            slide.on(SLIDE_EVENTS.syncDispatch, this.onSlideEventDispatch);

            this.slide = slide;
            (window as any).slide = slide as any;
            ProjectorPlugin.logger.info("[Projector plugin] init slide done");
            return this.slide;
        });
    }

    public setResource = async (taskId: string, prefix: string): Promise<void> => {
        const slide = this.getSlideObj();
        slide.setResource(taskId, prefix);
        const [width, height] = await slide.getSizeAsync();
        this.slideWidth = width;
        this.slideHeight = height;
    }

    public async setSlideState(slideState: SlideState): Promise<void> {
        await this.setSlideAndWhiteboardSize(this.getSlideObj());
        await this.getSlideObj().setSlideState(slideState);
    }

    public getSlideState(): SlideState {
        return this.getSlideObj().slideState;
    }
}