import type { SyncEvent} from "@netless/slide";
import { Slide, SLIDE_EVENTS, waitUntil } from "@netless/slide";
import type { Displayer, DisplayerState, Room} from "white-web-sdk";
import {  isRoom as _isRoom } from "white-web-sdk";
import { ProjectorError, ProjectorErrorType } from "./error";
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

    private getSlideObj(): Slide | undefined {
        if (this.slide) {
            return this.slide;
        } else {
            ProjectorPlugin.projectorCallbacks.errorCallback(new ProjectorError(`[Projector plugin] can not find slide object`, ProjectorErrorType.RuntimeError));
            return undefined;
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
        const slide = this.getSlideObj();
        if (slide) {
            await this.setSlideAndWhiteboardSize(slide);
            slide.renderSlide(index);
        }
    };

    public async getSlidePageCount(): Promise<number> {
        const slide = this.getSlideObj();
        if (slide) {
            return await slide.getSlideCountAsync()
        } else {
            return 0;
        }
    }

    public initSlide = async(): Promise<Slide> => {
        return waitUntil(() => {
            return !!ProjectorDisplayer.instance && !!ProjectorDisplayer.instance!.containerRef;
        }, 10000).then(() => {
            if (this.slide) {
                return this.slide;
            }
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
        if (slide) {
            slide.setResource(taskId, prefix);
            const [width, height] = await slide.getSizeAsync();
            this.slideWidth = width;
            this.slideHeight = height;
        }
    }

    public async setSlideState(slideState: SlideState): Promise<void> {
        const slide = this.getSlideObj();
        if (slide) {
            await this.setSlideAndWhiteboardSize(slide);
            await slide.setSlideState(slideState);
        }
    }
}