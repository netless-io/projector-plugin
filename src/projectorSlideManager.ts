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
        ProjectorPlugin.logger.info("[Projector plugin]: local state changed ", {...state}) ;
        if (isRoom(this.context.displayer) && (this.context.displayer as Room).isWritable) {
            const slideState = this.context.attributes[state.taskId] as SlideState;
            let slideChanged = false;
            if (slideState?.currentSlideIndex !== state.currentSlideIndex) {
                slideChanged = true;
            }
            this.context.setAttributes({[state.taskId]: state});
            if (slideChanged) {
                const scenePath = `/${ProjectorPlugin.kind}/${this.slide?.slideState.taskId}/${state.currentSlideIndex}`;
            
                ProjectorPlugin.logger.info(`[Projector plugin] scenePath change to ${scenePath}`);
                (this.context.displayer as Room).setScenePath(scenePath);
            }
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

    private onSlideRendered = (index: number): void =>  {
        if (this.slide) {
            ProjectorPlugin.projectorCallbacks.onSlideRendered(this.slide.slideState.taskId, index);
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

    private getSlideObj(): Slide | undefined {
        if (this.slide) {
            return this.slide;
        } else {
            ProjectorPlugin.projectorCallbacks.errorCallback(new ProjectorError(`[Projector plugin] can not find slide object`, ProjectorErrorType.RuntimeError));
            return undefined;
        }
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
                if (this.slideWidth && this.slideHeight) {
                    if (!ProjectorDisplayer.instance!.containerRef!.style.width) {
                        ProjectorDisplayer.instance!.containerRef!.style.width = `${this.slideWidth}px`;
                        ProjectorDisplayer.instance!.containerRef!.style.height = `${this.slideHeight}px`;
                    }

                    const currentWidth = ProjectorDisplayer.instance.containerRef.style.width;
                    const slideScale = this.slideWidth * scale / parseFloat(currentWidth);
                    ProjectorDisplayer.instance.containerRef.style.transform = `translate(${x}px,${y}px) scale(${slideScale}, ${slideScale})`;
                }
            }
        }
    }

    public nextStep():void {
        this.slide?.nextStep();
    }

    public prevStep():void {
        this.slide?.prevStep();
    }

    public destory(): void {
        this.slideHeight = undefined;
        this.slideWidth = undefined;
        if (!this.slide) {
            return;
        }
        // this.slide.clearSlideCache();
        this.slide.destroy();
        this.slide = undefined;

    }

    public renderSlide = async (index: number): Promise<void> => {
        const slide = this.getSlideObj();
        if (slide) {
            await this.setSlideAndWhiteboardSize(slide);
            slide.renderSlide(index);
        }
    };

    public async getSlidePageCount(): Promise<number> {
        const slide = this.getSlideObj();
        if (slide) {
            return await slide.getSlideCountAsync();
        } else {
            return 0;
        }
    }

    public initSlide = async(taskId: string, prefix: string): Promise<Slide> => {
        return waitUntil(() => {
            return !!ProjectorDisplayer.instance && !!ProjectorDisplayer.instance!.containerRef;
        }, 10000).then(() => {
            if (this.slide) {
                return this.slide;
            }
            const anchor = ProjectorDisplayer.instance!.containerRef!;
            console.log("projector-plugin, slide config:", ProjectorPlugin.slideConfig)
            const slide = new Slide({
                ...ProjectorPlugin.slideConfig,
                anchor: anchor,
                interactive: true,
                mode: "interactive",    // fixed
                resize: true,
                fixedFrameSize: {
                    width: anchor.getBoundingClientRect().width,
                    height: anchor.getBoundingClientRect().height
                },
                logger: ProjectorPlugin.logger,
            });
            slide.on(SLIDE_EVENTS.stateChange, this.onStateChange);
            slide.on(SLIDE_EVENTS.syncDispatch, this.onSlideEventDispatch);
            slide.on(SLIDE_EVENTS.renderEnd, this.onSlideRendered);

            this.slide = slide;
            (window as any).slide = slide as any;
            ProjectorPlugin.logger.info("[Projector plugin] init slide done");
            return this.slide;
        }).then(async slide => {
            slide.setResource(taskId, prefix);
            const [width, height] = await slide.getSizeAsync();
            this.slideWidth = width;
            this.slideHeight = height;
            slide.updateFixedFrameSize(width, height);
            return slide;
        });
    }

    public async setSlideState(slideState: SlideState): Promise<void> {
        const slide = this.getSlideObj();
        if (slide) {
            await this.setSlideAndWhiteboardSize(slide);
            await slide.setSlideState(JSON.parse(JSON.stringify(slideState)));
        }
    }
}