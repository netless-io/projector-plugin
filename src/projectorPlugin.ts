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
    isRoom as _isRoom,
} from "white-web-sdk";
import { ProjectorDisplayer } from "./projectorDisplayer";
import { waitUntil } from "./util";
import type { SyncEvent } from "@netless/slide";
import { Slide, SLIDE_EVENTS } from "@netless/slide";
import { EventEmitter2 } from "eventemitter2";
import type { ProjectorOption} from "./projectorSlideManager";
import { ProjectorSlideManager } from "./projectorSlideManager";

type SlideStore = {
    [uuid: string]: ProjectorSlideManager,
}


export enum ProjectorEvents {
    DisplayerDidMount = "DisplayerDidMount",
    EnableClick = "EnableClick",
    DisableClick = "DisableClick",
    UpdateParentContainerRect = "UpdateParentContainerRect",
    SetParentContainerRect = "SetParentContainerRect",
}

type ProjectorStateStore = {
    [uuid: string]: any,
    currentSlide?: string,
}

type EventPayload = {
    type: string,
    payload: SyncEvent,
}

const isRoom = _isRoom as (displayer: Displayer) => displayer is Room;

export declare type WhiteboardEventListener = (event: Event)=>void;

// TODO plugin 目前全局只能有一个 ppt，这种设计下，当用户翻到非 ppt 页会有两种策略：1.销毁状态 2.保留状态
// 1. 销毁：当用户翻页到 /init，状态销毁，再翻页回来，用户需要重新初始化 ppt，但是笔迹仍然是原来的；当用户直接翻页到其他 ppt 路径，用户需要删除当前 ppt 对象，再初始化另一个 ppt 对象
// 2. 保留：当用户从 ppt1 翻页到 /init，用户刷新，会


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

export class ProjectorPlugin extends InvisiblePlugin<ProjectorStateStore> {

    private slideStore: SlideStore = {};
    private currentSlideUUID?: string;
    // 组件类型，该组件的唯一识别符。应该取一个独特的名字，以和其他组件区分。
    static readonly kind: string = "projector-plugin";
    private static readonly scenePrefix: string = "projector-plugin";
    // 全局锁，由于用户白板切页和刚进入房间都会触发 roomstatechange 回调，无法判断用户是刚进入房间还是翻页，有可能触发两次初始化 ppt
    private static initializingSlideLock = false;
    public slide?: Slide;
    public static emitter: EventEmitter2 = new EventEmitter2();

    private logger: Logger = {
        info: console.log,
        warn: console.warn,
        error: console.error,
    };
    private projectorCallbacks: ProjectorCallback =  {
        errorCallback: (e: Error) => {console.error(e)}
    };
    private enableClickToNextStep = false;

    public getSlide(): Slide | undefined {return this.slide};

    // pluginDisplayer 元素挂载可能比 plugin 本身要晚，所以确保挂载后再设置一次属性
    private wrapperDidMountListener = () => {
        this.onApplianceChange();
    };

    public async initSlide(displayer: Displayer): Promise<ProjectorPlugin> {
        // 获取插件实例
        let projectorPlugin = displayer.getInvisiblePlugin(ProjectorPlugin.kind) as
            | ProjectorPlugin
            | undefined;
        if (!projectorPlugin) {
            if (isRoom(displayer) && displayer.isWritable) {
                if (!displayer.isWritable) {
                    displayer
                    throw new Error("room is not writable");
                }
                projectorPlugin = (await displayer.createInvisiblePlugin(
                    ProjectorPlugin,
                    {}
                )) as ProjectorPlugin;
            } else {
                throw new Error("[Projector plugin] plugin only working on writable room")
            }
        }
        this.displayer.addMagixEventListener(SLIDE_EVENTS.syncDispatch, this.whiteboardEventListener, {
            fireSelfEventAfterCommit: true,
        });
        ProjectorPlugin.emitter.once(ProjectorEvents.DisplayerDidMount, this.wrapperDidMountListener);
        return projectorPlugin;
    }

    private createSlide(option: ProjectorOption): ProjectorSlideManager {
        if (this.slideStore[option.uuid]) {
            return this.slideStore[option.uuid];
        } else {
            return new ProjectorSlideManager(this, option);
        }
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

        this.displayer.addMagixEventListener(SLIDE_EVENTS.syncDispatch, this.whiteboardEventListener, {
            fireSelfEventAfterCommit: true,
        });
        ProjectorPlugin.emitter.once(ProjectorEvents.DisplayerDidMount, this.wrapperDidMountListener);

        if (ProjectorPlugin.initializingSlideLock) {
            this.logger.info("[Projector plugin] slide is initializing")
            return;
        }
        ProjectorPlugin.initializingSlideLock = true;
        
        if (ProjectorPlugin.slide) {
            this.logger.info("[Projector plugin] slide hase been initialized")
            return;
        }
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

            ProjectorPlugin.slide = slide;
            this.logger.info("[Projector plugin] init slide done");
            return slide;
        }).then((slide: Slide) => {
            this.logger.info(`[Projector plugin] start load ppt, uuid: ${uuid}, prefix: ${prefix}`);
            this.loadPPT(slide, projectorPlugin!, uuid, prefix, slideIndex);
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
        if (!this.currentSlideUUID) {
            // ppt 还没初始化
            return;
        }
        const { type, payload } = ev.payload;
        if (type === SLIDE_EVENTS.syncDispatch) {
            this.logger.info(`[projector pluin]: received event `);
            this.slideStore[this.currentSlideUUID].slide.emit(SLIDE_EVENTS.syncReceive, payload);
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
        console.log("wb change ", state.cameraState);
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

    // 如果切走了就清空一切状态
    private unmountSlide(): void {
        this.displayer.callbacks.off(this.callbackName as any, this.roomStateChangeListener);
        this.setAttributes({slideState: undefined});
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
    private async loadPPT(slide: Slide, projectorPlugin: ProjectorPlugin, uuid: string, prefix: string, slideIndex?: number): Promise<void> {
        // 先读取房间原有状态，如果有状态那么以房间内的状态为准，如果没有那么就渲染第一页
        if (projectorPlugin.attributes?.slideState) {
            // 如果是中途加入需要读取房间内的插件属性
            await this.loadPPTByAttributes(slide, projectorPlugin.attributes.slideState);
            if (slideIndex !== undefined) {
                slide.renderSlide(slideIndex);
            }
        } else {
            slide.setResource(uuid, prefix);
            // 第一次创建 ppt 需要创建每一页对应的 scene
            await this.initWhiteboardScenes(uuid, slide);
            slide.renderSlide(1, true);
            projectorPlugin.setAttributes({
                slideState: slide.slideState
            });
        }
        this.logger.info(`[Projector plugin] load ppt done, uuid: ${uuid}, prefix: ${prefix}`);
    }

    private async setSlideAndWhiteboardSize(slide: Slide): Promise<void> {
        const [width, height] = await slide.getSizeAsync();
        console.log("---> ", width, height);
        ProjectorDisplayer.instance!.containerRef!.style.width = `${width}px`;
        ProjectorDisplayer.instance!.containerRef!.style.height = `${height}px`;
        this.alignWhiteboardAndSlide(width, height);
    }

    private alignWhiteboardAndSlide(slideWidth: number, slideHeight: number) {
        this.displayer.moveCamera({
            centerX: 0,
            centerY: 0,
            scale: 1,
        });
        // 将白板缩放与 ppt 缩放绑定
        this.displayer.callbacks.on(this.callbackName as any, this.roomStateChangeListener);
       
        // 调整白板至与 ppt 尺寸一致，并对准中心，同时占满整个页面
        this.displayer.moveCameraToContain({
            originX: 0,
            originY: 0,
            width: slideWidth,
            height: slideHeight,
        });
        this.displayer.moveCamera({
            centerX: 0,
            centerY: 0,
        });
    }

    private async loadPPTByAttributes(slide: Slide, slideState: any) {
        this.logger.info(`[Projector plugin] load by slide state: ${JSON.stringify(slideState)}`);
        await slide.setSlideState(slideState);
        
        await this.setSlideAndWhiteboardSize(slide);
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