import { Slide, SLIDE_EVENTS, waitUntil } from "@netless/slide";
import type { Displayer, Room, RoomState} from "white-web-sdk";
import {  isRoom as _isRoom } from "white-web-sdk";
import { ProjectorDisplayer } from "./projectorDisplayer";
import { ProjectorPlugin } from "./projectorPlugin";

export type ProjectorCallback = {
    errorCallback: (e: Error) => void;
}
export type ProjectorOption = {
    uuid: string,
    prefix: string,
    slideIndex?: number,
    logger?: Logger;
    callback?: ProjectorCallback;
    enableClickToNextStep?: boolean;
}
export type Logger = {
    readonly info: (...messages: any[]) => void;
    readonly warn: (...messages: any[]) => void;
    readonly error: (...messages: any[]) => void;
}

const isRoom = _isRoom as (displayer: Displayer) => displayer is Room;

export class ProjectorSlideManager {
    private logger: Logger = {
        info: console.log,
        warn: console.warn,
        error: console.error,
    };
    private projectorCallbacks: ProjectorCallback =  {
        errorCallback: (e: Error) => {console.error(e)}
    };
    private enableClickToNextStep = false;
    public slide: Slide | undefined;
    private context: ProjectorPlugin;

    // context 持有 plugin 会不会导致内存问题或者引用问题？
    constructor(context: ProjectorPlugin, option: ProjectorOption) {
        this.context = context;
        const {uuid, prefix, slideIndex, logger, callback, enableClickToNextStep} = option;
        if (logger) {
            this.logger = logger;
        }
        if (callback) {
            this.projectorCallbacks = callback;
        }
        if (enableClickToNextStep) {
            this.enableClickToNextStep = enableClickToNextStep;
        }

        waitUntil(() => {
            return !!ProjectorDisplayer.instance && !!ProjectorDisplayer.instance!.containerRef;
        }, 10000).then(() => {
            // 开始直接构造 slide 对象，当切换 ppt 时要保证先 destroy 原来的 slide 对象再 new 出来
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
            this.logger.info("[Projector plugin] init slide done");
            return slide;
        }).then((slide: Slide) => {
            this.logger.info(`[Projector plugin] start load ppt, uuid: ${uuid}, prefix: ${prefix}`);
            this.loadPPT(slide, uuid, prefix, slideIndex);
        });
    }

    private onStateChange(): void {}
    private onSlideChange(): void {}
    private onSlideEventDispatch(): void {}

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
            this.context.setAttributes({
                [uuid]: slide.slideState,
                currentSlide: uuid,
            });
        }
        this.logger.info(`[Projector plugin] load ppt done, uuid: ${uuid}, prefix: ${prefix}`);
    }

    private async loadPPTByAttributes(slide: Slide, slideState: any) {
        this.logger.info(`[Projector plugin] load by slide state: ${JSON.stringify(slideState)}`);
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
            this.onApplianceChange();
        }
        if (state.sceneState) {
            this.logger.info(`[Projector plugin] scene changed ${state.sceneState.scenePath}`);
            
            if (!state.sceneState.scenePath.startsWith(`/${ProjectorPlugin.scenePrefix}`)) {
                this.unmountSlide();
            } else if (state.sceneState.scenePath !== `/${ProjectorPlugin.scenePrefix}/${ProjectorPlugin.slide?.slideState.taskId}/${ProjectorPlugin.slide?.slideState.currentSlideIndex}`) {
                const slideIndex = state.sceneState.scenePath.split("/")[3];
                // uuid、 prefix 可能不对，因此从 slide state 中读取的可能不是同一个 ppt 的内容，这点需要用户来保证
                if (ProjectorPlugin.slide) {
                    ProjectorPlugin.slide?.renderSlide(parseInt(slideIndex));
                } else {
                    // 从没有 ppt 的页面切换到了 ppt 页，需要重新初始化 ppt
                    const projectorPlugin = this.displayer.getInvisiblePlugin(ProjectorPlugin.kind) as ProjectorPlugin
                    
                    if (projectorPlugin.attributes && projectorPlugin.attributes.slideState) {
                        // 从 slide state 中恢复 ppt
                        this.logger.info("[Projector plugin] restore slide by attributes");
                        this.initSlide(this.displayer, projectorPlugin.attributes.slideState.taskId, projectorPlugin.attributes.slideState.url)
                    } else {
                        // 没有找到状态，无法恢复，需要用户手动调用 initslide
                        this.projectorCallbacks.errorCallback(new Error("[Projector plugin] can not find slide state, you must initiate slide first"));
                    }
                }
            }
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
        const slideCount = await slide.getSlideCountAsync();
        if (isRoom(this.context.displayer)) {
            const room = this.context.displayer;
            const scenes = new Array(slideCount).fill('').map((_, index) => {
                return {
                    name: `${index}`,
                };
            });
            this.logger.info(`[Projector plugin] create new scenes`);
            room.putScenes(`/${ProjectorPlugin.kind}/${uuid}`, scenes);
        }
        // 回放房间不用初始化场景
    }
}