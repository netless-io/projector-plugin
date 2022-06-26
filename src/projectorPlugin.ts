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
import type { SyncEvent , Slide} from "@netless/slide";
import { SLIDE_EVENTS } from "@netless/slide";
import { EventEmitter2 } from "eventemitter2";
import type { SlideState } from "./projectorSlideManager";
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

type ProjectorSlideOption = {
    uuid: string,
    prefix: string,
}

type ProjectorStateStore = {
    [uuid: string]: SlideState | string,
} & {
    currentSlideUUID: string,
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

    public static currentSlideManager?: ProjectorSlideManager;
    
    // pluginDisplayer 元素挂载可能比 plugin 本身要晚，所以确保挂载后再设置一次属性
    private wrapperDidMountListener = () => {
        this.onApplianceChange();
    };

    onAttributesUpdate = async (attributes: ProjectorStateStore): Promise<void> => {
        if (attributes.currentSlideUUID) {
            if (!ProjectorPlugin.currentSlideManager) {
                ProjectorPlugin.currentSlideManager = new ProjectorSlideManager(this);
                await ProjectorPlugin.currentSlideManager.initSlide();
            }
        }
    }

    /**
     * received event from whiteboard
     */
     private whiteboardEventListener: WhiteboardEventListener = ev => {
        if (!ProjectorPlugin.currentSlideManager) {
            // ppt 还没初始化
            return;
        }
        const { type, payload } = ev.payload;
        if (type === SLIDE_EVENTS.syncDispatch) {
            ProjectorPlugin.logger.info(`[projector pluin]: received event `);
            ProjectorPlugin.currentSlideManager.slide?.emit(SLIDE_EVENTS.syncReceive, payload);
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
    private roomStateChangeListener = async (state: RoomState) => {
        console.log("change ", {...state});
        
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
            ProjectorPlugin.logger.info(`[Projector plugin] scene changed ${state.sceneState.scenePath}`);
            
            if (!state.sceneState.scenePath.startsWith(`/${ProjectorPlugin.kind}`)) {
                this.unmountSlide();
            } else {
                const uuid = state.sceneState.scenePath.split("/")[2];
                const slideIndex = state.sceneState.scenePath.split("/")[3];
                if (ProjectorPlugin.currentSlideManager) {
                    const slideState = ProjectorPlugin.currentSlideManager.getSlideState();
                    if (slideState.taskId !== uuid || slideState.currentSlideIndex !== parseInt(slideIndex)) {
                        // scenePath 与 slideState 对不上，以 slidestate 为准
                        await this.restoreSlideByState(slideState);
                    }
                }
            }
        }
    }

    private restoreSlideByState = async (slideState: SlideState): Promise<void> => {
        if (!ProjectorPlugin.currentSlideManager) {
            ProjectorPlugin.currentSlideManager = new ProjectorSlideManager(this);
            await ProjectorPlugin.currentSlideManager.initSlide();
        }
        ProjectorPlugin.currentSlideManager.setResource(slideState.taskId, slideState.url);
        if (isRoom(this.displayer) && this.displayer.isWritable) {
            const scenePath = `/${ProjectorPlugin.kind}/${slideState.taskId}/${slideState.currentSlideIndex}`;

            ProjectorPlugin.logger.info(`[Projector plugin] scenePath change to ${scenePath}`);
            this.displayer.setScenePath(scenePath);
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
        if (ProjectorPlugin.currentSlideManager) {
            ProjectorPlugin.logger.info(`[Projector plugin] unmount slide object`);
            ProjectorPlugin.currentSlideManager.destory();

            ProjectorPlugin.currentSlideManager = undefined;

            this.setAttributes({
                currentSlideUUID: undefined,
            });
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

    private async jumpToScene(uuid: string, slideIndex?: number): Promise<void> {
        if (isRoom(this.displayer)) {
            let index = 1;
            if (slideIndex !== undefined) {
                index = slideIndex;
            }
            const scenePath = `/${ProjectorPlugin.kind}/${uuid}/${index}`;

            this.displayer.setScenePath(scenePath);
        }
    }

    private getManagerInstance() {
        if (ProjectorPlugin.currentSlideManager) {
            return ProjectorPlugin.currentSlideManager;
        } else {
            throw new Error("[Projector plugin] can not find slideManager");
        }
    }

    private init = (): void => {
        // 这两个监听应该在初始化的时候
        this.displayer.addMagixEventListener(SLIDE_EVENTS.syncDispatch, this.whiteboardEventListener, {
            fireSelfEventAfterCommit: true,
        });
        // displayer 初始化先于 plugin 实例创建，那么可能监听不到，主动获取一次确保状态正确
        ProjectorPlugin.emitter.once(ProjectorEvents.DisplayerDidMount, this.wrapperDidMountListener);
        this.displayer.callbacks.on(this.callbackName as any, this.roomStateChangeListener);
        
        this.onApplianceChange();
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
        projectorPlugin.init();
        return projectorPlugin;
    }

    // 调用 create 方法会让 state 从第一页开始，状态全部初始化，如果原来已经有 slidestate 将会被重置，操作者角色调用
    public async createSlide(option: ProjectorSlideOption): Promise<void> {
        const slideManager = new ProjectorSlideManager(this);
        const slide = await slideManager.initSlide();
        slideManager.setResource(option.uuid, option.prefix);
        // TODO current 是否有必要？
        ProjectorPlugin.currentSlideManager = slideManager;
        console.log("create done", option.uuid, this.attributes[option.uuid]);
        
        const slideCount = await slideManager.getSlideCount();
        await this.putWhiteboardScenes(option.uuid, slideCount);
        
        this.setAttributes({
            [option.uuid]: slide.slideState,
            currentSlideUUID: option.uuid,
        });

        ProjectorPlugin.currentSlideManager.renderSlide(1);
    }

    // 操作者角色调用，切换到已经创建好的 slide
    public async changeSlide(uuid: string): Promise<void> {
        const slideState = this.attributes[uuid] as SlideState;
        if (slideState) {
            this.setAttributes({
                currentSlideUUID: slideState.taskId,
            });
            let index = 1;
            if (slideState.currentSlideIndex && slideState.currentSlideIndex !== -1) {
                index = slideState.currentSlideIndex;
            }
            await this.jumpToScene(slideState.taskId, index);
        } else {
            throw new Error("[Projector plugin] slide not created");
        }
    }

    public setInteractivable(interactivable: boolean): void {
        const slide = ProjectorPlugin.currentSlideManager?.slide;
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
            // TODO 判断如果在当前 uuid 下，不能删除，要先删除 scenepath，再删除场景
        } else {
            ProjectorPlugin.logger.error(`[Projector plugin] can not do this operation in replay`);
        }
    }

    public listSlides(): void {
        Object.keys(this.attributes);
    }
}