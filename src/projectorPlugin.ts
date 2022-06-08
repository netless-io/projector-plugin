import type {
    InvisiblePluginContext,
    RoomState,
    Event,
    Room,
    Displayer,
    DisplayerState} from "white-web-sdk";
import {
    InvisiblePlugin,
    isPlayer,
    isRoom,
} from "white-web-sdk";
import { ProjectorDisplayer } from "./projectorDisplayer";
import { waitUntil } from "./util";
import type { SyncEvent } from "@netless/slide";
import { Slide, SLIDE_EVENTS } from "@netless/slide";
import { EventEmitter2 } from "eventemitter2";

export type ProjectorPluginOption = {
    logger?: Logger;
    callback?: ProjectorCallback;
    enableClickToNextStep?: boolean;
}
export type Logger = {
    readonly info: (...messages: any[]) => void;
    readonly warn: (...messages: any[]) => void;
    readonly error: (...messages: any[]) => void;
}

export type ProjectorCallback = {
    errorCallback: (e: Error) => void;
}
export enum ProjectorEvents {
    DisplayerDidMount = "DisplayerDidMount",
    EnableClick = "EnableClick",
    DisableClick = "DisableClick",
    UpdateParentContainerRect = "UpdateParentContainerRect",
    SetParentContainerRect = "SetParentContainerRect",
}

type ProjectorState = {
    slideState: any,
}

type EventPayload = {
    type: string,
    payload: SyncEvent,
}

export declare type WhiteboardEventListener = (event: Event)=>void;

// ProjectorPlugin 由于是垫在白板底部，在设计上一页只能有一个，全局唯一，所以切换 ppt 需要卸载掉 slide 然后重建
// ProjectorPlugin 在创建后本身不会被销毁
// 操作逻辑:
//  1. 创建组件时可以选择模式，调用 ProjectorPlugin 的 init 方法   done
//  2. init 方法中 new Slide，如果用户要切换模式可以通过再次调用 init 方法   done
//  3. new Slide 后监听白板翻页事件，如果白板翻页，那么要调用 slide 的翻页，如果 slide 通过动画翻页，那么也要回调白板翻页
//  4. 在用户要插入 ppt 的时候调用 ProjectorPlugin 的 setResource 方法，如果要切换 ppt 就再次调用
//  5. setResource 后第一时间要读取 ppt 页数，然后插入到白板中，scenenPath: projector/${uuid}/index， 同时创建 globalstate，结构 projector: {uuid: state}
//  6. ppt 监听 slide 的状态变化更新到 globalstate 中
//  7. 提供 clean 方法，移除事件监听，删除 slide 对象，但是可以再次 init

export class ProjectorPlugin extends InvisiblePlugin<ProjectorState> {

    // 组件类型，该组件的唯一识别符。应该取一个独特的名字，以和其他组件区分。
    static readonly kind: string = "projector-plugin";
    private static readonly scenePrefix: string = "projector-plugin";
    // 全局锁，由于用户白板切页和刚进入房间都会触发 roomstatechange 回调，无法判断用户是刚进入房间还是翻页，有可能触发两次初始化 ppt
    private static initializingSlideLock = false;
    // 装白板和 ppt 容器的dom，需要这个元素的宽高来计算缩放时的偏移
    private containerDomRect: DOMRect | null = null;
    private static height: number;
    private static width: number;

    private logger: Logger = {
        info: console.log,
        warn: console.warn,
        error: console.error,
    };
    private projectorCallbacks: ProjectorCallback =  {
        errorCallback: (e: Error) => {console.error(e)}
    };
    private enableClickToNextStep = false;

    public static slide: Slide | undefined;
    public static emitter: EventEmitter2 = new EventEmitter2();
    
    public getSlide(): Slide | undefined {return ProjectorPlugin.slide};

    constructor(context: InvisiblePluginContext, option?: ProjectorPluginOption) {
        super(context);
        if (option?.logger) {
            this.logger = option.logger;
        }
        if (option?.callback) {
            this.projectorCallbacks = option.callback;
        }
        if (option?.enableClickToNextStep) {
            this.enableClickToNextStep = option.enableClickToNextStep;
        }

        this.displayer.callbacks.on(this.callbackName as any, this.roomStateChangeListener);
        this.displayer.addMagixEventListener(SLIDE_EVENTS.syncDispatch, this.whiteboardEventListener, {
            fireSelfEventAfterCommit: true,
        });
        ProjectorPlugin.emitter.once(ProjectorEvents.DisplayerDidMount, this.wrapperDidMountListener);
        ProjectorPlugin.emitter.on(ProjectorEvents.SetParentContainerRect, rect => {
            this.containerDomRect = rect;
        });
    }

    // pluginDisplayer 元素挂载可能比 plugin 本身要完，所以确保挂载后再设置一次属性
    private wrapperDidMountListener = () => {
        this.onApplianceChange();
    };

    /**
     * @param displayer room object
     * @param slideIndex render specified index
     */
    public async initSlide(displayer: Displayer, uuid: string, prefix: string, slideIndex?: number): Promise<void> {
        if (ProjectorPlugin.initializingSlideLock) {
            this.logger.info("[Projector plugin] slide is initializing")
            return;
        }
        ProjectorPlugin.initializingSlideLock = true;
        
        if (ProjectorPlugin.slide) {
            this.logger.info("[Projector plugin] slide hase been initialized")
            return;
        }
        
        // 删除旧 slide
        this.unmountSlide();

        let projectorPlugin = displayer.getInvisiblePlugin(ProjectorPlugin.kind) as
            | ProjectorPlugin
            | undefined;
        if (!projectorPlugin) {
            if (isRoom(displayer) && (displayer as Room).isWritable) {
                projectorPlugin = (await (displayer as Room).createInvisiblePlugin(
                    ProjectorPlugin,
                    {}
                )) as ProjectorPlugin;
            } else {
                this.projectorCallbacks.errorCallback(new Error("[Projector plugin] plugin only working on writable room"));
                ProjectorPlugin.initializingSlideLock = false;
                return;
            }
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
            if (this.attributes.slideState) {
                slide.setSlideState(this.attributes.slideState);
            }
            if (slideIndex !== undefined) {
                slide.renderSlide(slideIndex);
            }
            ProjectorPlugin.slide = slide;
            ProjectorPlugin.emitter.emit(ProjectorEvents.UpdateParentContainerRect);
            this.logger.info("[Projector plugin] init slide done");
        }).then(() => {
            this.logger.info(`[Projector plugin] start load ppt, uuid: ${uuid}, prefix: ${prefix}`);
            this.loadPPT(projectorPlugin!, uuid, prefix);
            
        }).finally(() => {
            ProjectorPlugin.initializingSlideLock = false;
        });
    }

    /**
     * dispatch whiteboard event from slide
     */
    private onSlideEventDispatch = (event: SyncEvent) => {
        if (isRoom(this.displayer) && (this.displayer as Room).isWritable) {
            const payload: EventPayload = {
                type: SLIDE_EVENTS.syncDispatch,
                payload: event,
            };
            this.logger.info("[Projector plugin] dispatch: ", JSON.stringify(event));
            (this.displayer as Room).dispatchMagixEvent(SLIDE_EVENTS.syncDispatch, payload);
        }
    }

    /**
     * received event from whiteboard
     */
    private whiteboardEventListener: WhiteboardEventListener = ev => {
        const { type, payload } = ev.payload;
        if (type === SLIDE_EVENTS.syncDispatch) {
            this.logger.info(`[projector pluin]: received event `);
            ProjectorPlugin.slide?.emit(SLIDE_EVENTS.syncReceive, payload);
        }
    };

    /**
     * record slide state in whiteboard attribute for restore slide
     */
    private onStateChange = (state: any) => {
        this.logger.info("[Projector plugin]: local state changed");
        if (isRoom(this.displayer) && (this.displayer as Room).isWritable) {
            this.setAttributes({slideState: state});
        }
    };

    /**
     * change whiteboard scene when slide index changed
     */
    private onSlideChange = (index: number) => {
        this.logger.info(`[Projector plugin] slide change to ${index}`);
        if (isRoom(this.displayer) && (this.displayer as Room).isWritable) {
            const scenePath = `/${ProjectorPlugin.scenePrefix}/${ProjectorPlugin.slide?.slideState.taskId}/${index}`;

            this.logger.info(`[Projector plugin] scenePath change to ${scenePath}`);
            (this.displayer as Room).setScenePath(scenePath);
        }
    }

    public setInteractivable(interactivable: boolean): void {
        ProjectorPlugin.slide?.setInteractive(interactivable);
    }

    private onApplianceChange() {
        if (this.canClick()) {
            ProjectorPlugin.emitter.emit(ProjectorEvents.EnableClick);
        } else {
            ProjectorPlugin.emitter.emit(ProjectorEvents.DisableClick);
        }
    }

    /**
     * 1. change slide index when whiteboard scene changed
     * 2. unmount slide when scene change to non-slide scene
     * 3. restore slide when scene change from non-slide scene to slide scene
     * 用户必须保证在从非 ppt 页切到 ppt 页时调用 initSlide 来设置好 uuid 和 prefix
     */
    private roomStateChangeListener = (state: RoomState) => {
        if (state.cameraState) {
            ProjectorPlugin.emitter.emit(ProjectorEvents.UpdateParentContainerRect);
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
        const cameraState = state.cameraState;
        if (ProjectorDisplayer.instance) {
            const {width, height, scale, centerX, centerY} = cameraState;
            
            const rootRect = this.containerDomRect || { x: 0, y: 0 }
            const transformOriginX = `${(width / 2) + rootRect.x}px`;
            const transformOriginY = `${(height / 2) + rootRect.y}px`;
            const transformOrigin = `${transformOriginX} ${transformOriginY}`;
            // 用 ppt 的原始宽高计算两个中心点经过缩放后的偏移
            const iframeXDiff = ((width - ProjectorPlugin.width) / 2) * scale;
            const iframeYDiff = ((height - ProjectorPlugin.height) / 2) * scale;
            const x = - (centerX * scale) + iframeXDiff;
            const y = - (centerY * scale) + iframeYDiff;
            if (ProjectorDisplayer.instance?.containerRef) {
                ProjectorDisplayer.instance.containerRef.style.transformOrigin = transformOrigin;
                ProjectorDisplayer.instance.containerRef.style.transform = `translate(${x}px,${y}px) scale(${scale}, ${scale})`;
            }
        }
    }

    private get isReplay(): boolean {
        return isPlayer(this.displayer);
    }
    private get callbackName(): string {
        return this.isReplay ? "onPlayerStateChanged" : "onRoomStateChanged";
    }

    // 只有点击教具才能触发 ppt 事件
    private canClick(): boolean {
        if (!(this.displayer as any).isWritable) {
            return false;
        }
        const currentApplianceName = (this.displayer as Room).state.memberState.currentApplianceName;
        return currentApplianceName === "clicker";
    }

    private unmountSlide(): void {
        if (ProjectorPlugin.slide) {
            this.logger.info(`[Projector plugin] unmount slide object`);
            ProjectorPlugin.slide.clearSlideCache();
            ProjectorPlugin.slide.destroy();

            ProjectorPlugin.slide = undefined;
        }
    }

    /**
     * 通过 ppt 转换任务的 taskId 加载 ppt
     * @param uuid
     */
    private async loadPPT(projectorPlugin: ProjectorPlugin, uuid: string, prefix: string): Promise<void> {
        if (!ProjectorPlugin.slide) {
            this.projectorCallbacks.errorCallback(new Error("[Projector plugin] you must initiate slide first"));
            return;
        } else {
            // 先读取房间原有状态，如果有状态那么以房间内的状态为准，如果 state 没有 index 那么就渲染第一页
            if (projectorPlugin.attributes && projectorPlugin.attributes.slideState!= undefined) {
                // 如果是中途加入需要读取房间内的插件属性
                await this.loadPPTByAttributes(ProjectorPlugin.slide, projectorPlugin.attributes.slideState);
            } else {
                ProjectorPlugin.slide.setResource(uuid, prefix);
                await this.setSlideSize(ProjectorPlugin.slide);
                // 第一次创建 ppt 需要创建每一页对应的 scene
                await this.initWhiteboardScenes(uuid, ProjectorPlugin.slide);
                ProjectorPlugin.slide.renderSlide(1, true);
                projectorPlugin.setAttributes({
                    slideState: ProjectorPlugin.slide.slideState
                });
            }
            this.logger.info(`[Projector plugin] load ppt done, uuid: ${uuid}, prefix: ${prefix}`);
        }
    }

    private async setSlideSize(slide: Slide): Promise<void> {
        const [width, height] = await slide.getSizeAsync();
        console.log(width, height);
        ProjectorPlugin.width = width;
        ProjectorPlugin.height = height;
        this.computedStyle(this.displayer.state);
    }

    private async loadPPTByAttributes(slide: Slide, slideState: any) {
        this.logger.info(`[Projector plugin] load by slide state: ${JSON.stringify(slideState)}`);
        const room = (this.displayer as Room);
        room.setScenePath(`/${ProjectorPlugin.scenePrefix}/${slideState.taskId}/${slideState.currentSlideIndex}`);
        slide.setSlideState(slideState);
        await this.setSlideSize(slide);
    }

    private async initWhiteboardScenes(uuid: string, slide: Slide): Promise<void> {
        const slideCount = await slide.getSlideCountAsync();
        const room = (this.displayer as Room);
        const scenes = new Array(slideCount).fill('').map((_, index) => {
            return {
                name: `${index}`,
            };
        });
        this.logger.info(`[Projector plugin] create new scenes`);
        room.putScenes(`/${ProjectorPlugin.scenePrefix}/${uuid}`, scenes);
    }

    public nextStep(): void {
        ProjectorPlugin.slide?.nextStep();
    }

    public prevStep(): void {
        ProjectorPlugin.slide?.prevStep();
    }

    /**
     * clean slide attributes when state is messing
     */
    public cleanPluginAttributes(): void {
        const projectorPlugin = this.displayer.getInvisiblePlugin(ProjectorPlugin.kind) as
            | ProjectorPlugin
            | undefined;
        if (projectorPlugin) {
            projectorPlugin.setAttributes({slideState: undefined});
        }
    }
}