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
import type { SyncEvent , Slide} from "@netless/slide";
import { SLIDE_EVENTS } from "@netless/slide";
import { EventEmitter2 } from "eventemitter2";
import type { ProjectorSlideOption} from "./projectorSlideManager";
import { ProjectorSlideManager } from "./projectorSlideManager";

export type Logger = {
    readonly info: (...messages: any[]) => void;
    readonly warn: (...messages: any[]) => void;
    readonly error: (...messages: any[]) => void;
}
export type ProjectorCallback = {
    errorCallback: (e: Error) => void;
}

type ProjectorAdaptor = {
    logger?: Logger;
    callback?: ProjectorCallback;
}

export enum ProjectorEvents {
    DisplayerDidMount = "DisplayerDidMount",
    EnableClick = "EnableClick",
    DisableClick = "DisableClick",
    UpdateParentContainerRect = "UpdateParentContainerRect",
    SetParentContainerRect = "SetParentContainerRect",
}

type ProjectorStateStore = {
    [uuid: string]: ProjectorSlideManager,
}

const isRoom = _isRoom as (displayer: Displayer) => displayer is Room;

export declare type WhiteboardEventListener = (event: Event)=>void;

// plugin 渲染 ppt 应该有两个入口
// 1. 用户主动插入：这种情况用户调用 plugin 的 api，如果可以读取到对应 ppt 的 uuid 数据，那么读取该数据

export class ProjectorPlugin extends InvisiblePlugin<ProjectorStateStore> {
    // 组件类型，该组件的唯一识别符。应该取一个独特的名字，以和其他组件区分。
    static readonly kind: string = "projector-plugin";
    public static emitter: EventEmitter2 = new EventEmitter2();

    public static logger: Logger = {
        info: console.log,
        warn: console.warn,
        error: console.error,
    };
    public static projectorCallbacks: ProjectorCallback =  {
        errorCallback: (e: Error) => {console.error(e)}
    };

    public static currentSlideManagerId?: string;
    
    // pluginDisplayer 元素挂载可能比 plugin 本身要晚，所以确保挂载后再设置一次属性
    private wrapperDidMountListener = () => {
        this.onApplianceChange();
    };

    /**
     * received event from whiteboard
     */
     private whiteboardEventListener: WhiteboardEventListener = ev => {
        if (!ProjectorPlugin.currentSlideManagerId) {
            // ppt 还没初始化
            return;
        }
        const { type, payload } = ev.payload;
        if (type === SLIDE_EVENTS.syncDispatch) {
            ProjectorPlugin.logger.info(`[projector pluin]: received event `);
            this.getManagerInstance().slide!.emit(SLIDE_EVENTS.syncReceive, payload);
        }
    };

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
            console.log("camera change");
            this.computedStyle(state);
        }
        // 用户修改了教具会触发
        if (state.memberState) {
            console.log("appliance change");
            this.onApplianceChange();
        }
        if (state.sceneState) {
            console.log("scene change", state.sceneState);
            ProjectorPlugin.logger.info(`[Projector plugin] scene changed ${state.sceneState.scenePath}`);
            
            if (!state.sceneState.scenePath.startsWith(`/${ProjectorPlugin.kind}`)) {
                this.unmountSlide();
            } else {
                const uuid = state.sceneState.scenePath.split("/")[2];
                const slideIndex = state.sceneState.scenePath.split("/")[3];
                const slideManager = this.attributes[uuid];
                if (slideManager) {
                    ProjectorPlugin.currentSlideManagerId = uuid;
                    slideManager.renderSlide(parseInt(slideIndex));
                } else {
                    // 创建 slide 的时候是先 设置 manager 再 setscene，不应该读取不到
                    ProjectorPlugin.logger.error(`[Projector plugin] can not read slideManager by uuid ${uuid}`);
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
        if (ProjectorPlugin.currentSlideManagerId) {
            ProjectorPlugin.logger.info(`[Projector plugin] unmount slide object`);
            this.getManagerInstance().destory();

            ProjectorPlugin.currentSlideManagerId = undefined;
        }
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

    private async putWhiteboardScenes(uuid: string, slideCount: number): Promise<void> {
        const room = (this.displayer as Room);
        const scenes = new Array(slideCount).fill('').map((_, index) => {
            return {
                name: `${index}`,
            };
        });
        ProjectorPlugin.logger.info(`[Projector plugin] create new scenes`);
        room.putScenes(`/${ProjectorPlugin.kind}/${uuid}`, scenes);
    }

    private async jumpToScene(uuid: string, slideCount: number, slideIndex?: number): Promise<void> {
        if (isRoom(this.displayer)) {
            let index = 1;
            if (slideIndex !== undefined) {
                if (slideIndex <= 0) {
                    ProjectorPlugin.logger.warn("[Projector plugin] slideIndex param small than 1, slide will render index 1");
                    index = 1;
                } else if (slideIndex > slideCount) {
                    ProjectorPlugin.logger.warn("[Projector plugin] slideIndex param more than max slide count, slide will render max slide count");
                    index = slideCount;
                } else {
                    index = slideIndex;
                }
            }
            const scenePath = `/${ProjectorPlugin.kind}/${uuid}/${index}`;

            this.displayer.setScenePath(scenePath);
        }
    }

    private getManagerInstance() {
        if (ProjectorPlugin.currentSlideManagerId) {
            const manager = this.attributes[ProjectorPlugin.currentSlideManagerId];
            if (manager) {
                return manager;
            } 
        }
        throw new Error("[Projector plugin] can not find slideManager by currentSlideManagerId");
    }

    public static async getInstance(displayer: Displayer, adaptor?: ProjectorAdaptor): Promise<ProjectorPlugin> {
        if (adaptor?.logger) {
            ProjectorPlugin.logger = adaptor.logger;
        }
        if (adaptor?.callback) {
            ProjectorPlugin.projectorCallbacks = adaptor?.callback;
        }
        
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
        return projectorPlugin;
    }

    public init(): void {
        // 这两个监听应该在初始化的时候
        this.displayer.addMagixEventListener(SLIDE_EVENTS.syncDispatch, this.whiteboardEventListener, {
            fireSelfEventAfterCommit: true,
        });
        // displayer 初始化先于 plugin 实例创建，那么可能监听不到，主动获取一次确保状态正确
        ProjectorPlugin.emitter.once(ProjectorEvents.DisplayerDidMount, this.wrapperDidMountListener);
        this.displayer.callbacks.on(this.callbackName as any, this.roomStateChangeListener);
        
        this.onApplianceChange();
    }

    // 创建 ppt，只有主播会创建
    public async createSlide(option: ProjectorSlideOption): Promise<void> {
        let slideManager: ProjectorSlideManager;
        if (this.attributes[option.uuid]) {
            slideManager = (this.attributes[option.uuid] as ProjectorSlideManager);
        } else {
            // TODO 恢复 context
            slideManager = new ProjectorSlideManager(this, option);
        }
        await slideManager.initSlide();
        console.log("create done", option.uuid, this.attributes[option.uuid], slideManager);
        
        // TODO 循环引用？
        this.setAttributes({
            [option.uuid]: slideManager,
        });
        console.log("set done");
        const slideCount = await slideManager.getSlideCount();
        await this.putWhiteboardScenes(option.uuid, slideCount);
        
        await this.jumpToScene(option.uuid, slideCount, option.slideIndex);
    }

    public setInteractivable(interactivable: boolean): void {
        const slide = this.getManagerInstance().slide;
        if (slide) {
            slide.setInteractive(interactivable);
        } else {
            ProjectorPlugin.logger.error(`[Projector plugin] slide does not initialized`);
        }
    }

    public nextStep(): void {
        this.getManagerInstance().nextStep();
    }

    public prevStep(): void {
        this.getManagerInstance().prevStep();
    }

    /**
     * clean slide attributes when state is messing
     */
    public cleanPluginAttributes(): void {
        const attr: any = {};
        Object.keys(this.attributes).forEach(key => {
            attr[key] = undefined;
        });
        this.setAttributes({
            ...attr
        });
    }

    public deleteSlide(uuid: string): void {
        if (isRoom(this.displayer)) {
            // this.displayer.scenes()
        } else {
            ProjectorPlugin.logger.error(`[Projector plugin] can not do this operation in replay`);
        }
    }

    public listSlides(): void {
        Object.keys(this.attributes);
    }
}