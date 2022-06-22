import type { SyncEvent} from "@netless/slide";
import { Slide, SLIDE_EVENTS, waitUntil } from "@netless/slide";
import type { Displayer, DisplayerState, Room, RoomState} from "white-web-sdk";
import {  isRoom as _isRoom } from "white-web-sdk";
import { ProjectorDisplayer } from "./projectorDisplayer";
import type { Logger, ProjectorCallback } from "./projectorPlugin";
import { ProjectorPlugin } from "./projectorPlugin";

type EventPayload = {
    type: string,
    payload: SyncEvent,
}

export type ProjectorSlideOption = {
    uuid: string,
    prefix: string,
    slideIndex?: number,
    enableClickToNextStep?: boolean;
}

export type SlideManagerStatus = ProjectorSlideOption & {
    slideCount: number,
    slideState: any
}

const isRoom = _isRoom as (displayer: Displayer) => displayer is Room;

export class ProjectorSlideManager {
    private enableClickToNextStep = false;
    public slide: Slide | undefined;

    private _slideState: any;  // 不需要读取 slideState 中的内容，也不需要监听变化，只存储，在恢复页面的时候读取状态
    private context: ProjectorPlugin;
    private option: ProjectorSlideOption;

    // manager 创建后一定要有一个 slide 实例并且有 state 后，才会存入 store，从 store 读取的 manager 可以保证一定有 state
    constructor(context: ProjectorPlugin, option: ProjectorSlideOption) {
        // TODO 恢复 contxt
        this.context = context;
        const {uuid, prefix, enableClickToNextStep} = option;
        this.option = option;
        if (enableClickToNextStep) {
            this.enableClickToNextStep = enableClickToNextStep;
        }
    }

    private setSlideState(slideState: any) {
        this.getSlideObj().setSlideState(slideState);
    }

    private onStateChange(state: any): void {
        ProjectorPlugin.logger.info("[Projector plugin]: local state changed");
        if (isRoom(this.context.displayer) && (this.context.displayer as Room).isWritable) {
            this._slideState = state;
            this.context.setAttributes({[this._slideState.taskId]: this._slideState});
        }
    }

    private onSlideChange(index: number): void {
        ProjectorPlugin.logger.info(`[ProjecloadPPTByAttributestor plugin] slide change to ${index}`);
        if (isRoom(this.context.displayer) && (this.context.displayer as Room).isWritable) {
            const scenePath = `/${ProjectorPlugin.kind}/${this._slideState.taskId}/${index}`;

            ProjectorPlugin.logger.info(`[Projector plugin] scenePath change to ${scenePath}`);
            (this.context.displayer as Room).setScenePath(scenePath);
        }
    }
    private onSlideEventDispatch(event: SyncEvent): void {
        if (isRoom(this.context.displayer) && (this.context.displayer as Room).isWritable) {
            const payload: EventPayload = {
                type: SLIDE_EVENTS.syncDispatch,
                payload: event,
            };
            ProjectorPlugin.logger.info("[Projector plugin] dispatch: ", JSON.stringify(event));
            (this.context.displayer as Room).dispatchMagixEvent(SLIDE_EVENTS.syncDispatch, payload);
        }
    }

    /**
     * 通过 ppt 转换任务的 taskId 加载 ppt
     * @param uuid
     */
    private async loadPPT(slide: Slide, uuid: string, prefix: string, slideIndex?: number): Promise<void> {
        // 先读取房间原有状态，如果有状态那么以房间内的状态为准，如果没有那么就渲染第一页
        if (this.context.attributes?.[uuid]) {
            // 如果是中途加入需要读取房间内的插件属性
            await this.loadPPTByAttributes(slide, this.context.attributes[uuid]);
            if (slideIndex !== undefined) {
                slide.renderSlide(slideIndex);
            }
        } else {
            slide.setResource(uuid, prefix);
            // 第一次创建 ppt 需要创建每一页对应的 scene
            await this.initWhiteboardScenes(uuid, slide);
            slide.renderSlide(1, true);
            // TODO 每次更新 slidestate 的时候要调用更新 attribute 的方法
        }
        ProjectorPlugin.logger.info(`[Projector plugin] load ppt done, uuid: ${uuid}, prefix: ${prefix}`);
    }

    private async loadPPTByAttributes(slide: Slide, slideState: any) {
        ProjectorPlugin.logger.info(`[Projector plugin] load by slide state: ${JSON.stringify(slideState)}`);
        await slide.setSlideState(slideState);
        
        await this.setSlideAndWhiteboardSize(slide);
    }

    private async setSlideAndWhiteboardSize(slide: Slide): Promise<void> {
        const [width, height] = await slide.getSizeAsync();
        ProjectorDisplayer.instance!.containerRef!.style.width = `${width}px`;
        ProjectorDisplayer.instance!.containerRef!.style.height = `${height}px`;
        this.alignWhiteboardAndSlide(width, height);
    }

    private alignWhiteboardAndSlide(slideWidth: number, slideHeight: number) {
        this.context.displayer.moveCamera({
            centerX: 0,
            centerY: 0,
            scale: 1,
        });
        // 将白板缩放与 ppt 缩放绑定
        this.context.displayer.callbacks.on(this.callbackName as any, this.roomStateChangeListener);
       
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

    private get callbackName(): string {
        return !isRoom(this.context.displayer) ? "onPlayerStateChanged" : "onRoomStateChanged";
    }

    /**
     * 1. change slide index when whiteboard scene changed
     * 2. unmount slide when scene change to non-slide scene
     * 3. restore slide when scene change from non-slide scene to slide scene
     * 用户必须保证在从非 ppt 页切到 ppt 页时调用 initSlide 来设置好 uuid 和 prefix
     */
     private roomStateChangeListener = (state: RoomState) => {
        if (state.cameraState) {
            this.computedStyle(state);
        }
        // 用户修改了教具会触发
        if (state.memberState) {
            // this.onApplianceChange();
        }
    }

    private computedStyle(state: DisplayerState): void {
        if (ProjectorDisplayer.instance) {
            const {scale, centerX, centerY} = state.cameraState;
            // 由于 ppt 和白板中点已经对齐，这里缩放中心就是中点
            const transformOrigin = `center`;
            const x = - (centerX * scale);
            const y = - (centerY * scale);
            if (ProjectorDisplayer.instance?.containerRef) {
                ProjectorDisplayer.instance.containerRef.style.transformOrigin = transformOrigin;
                ProjectorDisplayer.instance.containerRef.style.transform = `translate(${x}px,${y}px) scale(${scale}, ${scale})`;
            }
        }
    }

    private async initWhiteboardScenes(uuid: string, slide: Slide): Promise<void> {
        slide.hasNextStep();
        const slideCount = await slide.getSlideCountAsync();
        if (isRoom(this.context.displayer)) {
            const room = this.context.displayer;
            const scenes = new Array(slideCount).fill('').map((_, index) => {
                return {
                    name: `${index}`,
                };
            });
            ProjectorPlugin.logger.info(`[Projector plugin] create new scenes`);
            room.putScenes(`/${ProjectorPlugin.kind}/${uuid}`, scenes);
        }
        // 回放房间不用初始化场景
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
        // TODO
        this.slide?.destroy();
        this.slide = undefined;
    }

    public renderSlide(index: number): void {
        this.getSlideObj().renderSlide(index);
    };

    public async getSlideCount(): Promise<number> {
        return await this.getSlideObj().getSlideCountAsync();
    }

    public static async getInstanceByManagerState(context: ProjectorPlugin, slideManagerStatus: SlideManagerStatus): Promise<ProjectorSlideManager> {
        const manager = new ProjectorSlideManager(context, {
            uuid: slideManagerStatus.uuid,
            prefix: slideManagerStatus.prefix,
            enableClickToNextStep: slideManagerStatus.enableClickToNextStep,
        });

        await manager.initSlide();
        // TODO 分开写  最后看需不需要提取
        manager.setResource(slideManagerStatus.uuid, slideManagerStatus.prefix);
        return manager;
    }

    public async initSlide(): Promise<Slide> {
        return waitUntil(() => {
            return !!ProjectorDisplayer.instance && !!ProjectorDisplayer.instance!.containerRef;
        }, 10000).then(() => {
            if (this.slide) {
                return this.slide;
            }
            const slide = new Slide({
                anchor: ProjectorDisplayer.instance!.containerRef!,
                interactive: true,
                mode: "interactive",    // 模式固定
                enableGlobalClick: this.enableClickToNextStep,
                resize: true,
            });
            slide.on(SLIDE_EVENTS.stateChange, this.onStateChange);
            slide.on(SLIDE_EVENTS.slideChange, this.onSlideChange);
            slide.on(SLIDE_EVENTS.syncDispatch, this.onSlideEventDispatch);

            this.slide = slide;
            ProjectorPlugin.logger.info("[Projector plugin] init slide done");
            return this.slide;
        });
    }

    public setResource(taskId: string, prefix: string): void {
        this.getSlideObj().setResource(taskId, prefix);
    }

    public getSlideState(): any {
        return this.getSlideObj().slideState;
    }
}