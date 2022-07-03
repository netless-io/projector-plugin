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

    private context: ProjectorPlugin;
    public slide: Slide | undefined;
    public slideWidth: number | undefined;
    public slideHeight: number | undefined;

    constructor(context: ProjectorPlugin) {
        this.context = context;
    }

    private onStateChange = (state: any): void => {
        ProjectorPlugin.logger.info("[Projector plugin]: local state changed");
        if (isRoom(this.context.displayer) && (this.context.displayer as Room).isWritable) {
            this.context.setAttributes({[state.taskId]: state});
        }
    }

    private onSlideChange = (index: number): void => {
        ProjectorPlugin.logger.info(`[ProjecloadPPTByAttributestor plugin] slide change to ${index}`);
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
       
        // Adjust the whiteboard to the same size as the ppt, align it to the center,
        // and fill the entire page at the same time
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
            // The midpoints of the ppt and the whiteboard are aligned, zoom center is the midpoint
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
                mode: "interactive",    // fixed
                resize: true,
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