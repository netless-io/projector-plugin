import type {
    RoomState,
    Event,
    Room,
    Displayer,
} from "white-web-sdk";
import {
    InvisiblePlugin,
    isPlayer,
    isRoom as _isRoom,
} from "white-web-sdk";
import { ProjectorDisplayer } from "./projectorDisplayer";
import { Slide, SLIDE_EVENTS } from "@netless/slide";
import { EventEmitter2 } from "eventemitter2";
import type { SlideState } from "./projectorSlideManager";
import { ProjectorSlideManager } from "./projectorSlideManager";
import { getslideCount, isFileExist } from "./util";

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


type ProjectorAdaptor = {
    logger?: Logger;
    callback?: ProjectorCallback;
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

export class ProjectorPlugin extends InvisiblePlugin<ProjectorStateStore> {
    // a unique king, different from other plugins.
    static readonly kind: string = "projector-plugin";
    // room scenen, used to determine whether this slide-page is jumped from non-slide-page
    private static _scenePath: string | undefined;
    public static _emitter: EventEmitter2 = new EventEmitter2();

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
            ProjectorPlugin._emitter.emit(ProjectorEvents.EnableClick);
        } else {
            ProjectorPlugin._emitter.emit(ProjectorEvents.DisableClick);
        }
    }

    private roomStateChangeListener = async (state: RoomState) => {
        if (state.cameraState) {
            if (ProjectorPlugin.currentSlideManager) {
                ProjectorPlugin.currentSlideManager.computedStyle(state);
            }
        }
        // 用户修改了教具会触发
        if (state.memberState) {
            if (ProjectorDisplayer.instance) {
                this.onApplianceChange();
            }
        }
        if (state.sceneState) {
            ProjectorPlugin.logger.info(`[Projector plugin] scene changed ${state.sceneState.scenePath}`);
            
            if (!state.sceneState.scenePath.startsWith(`/${ProjectorPlugin.kind}`)) {
                if (ProjectorPlugin._scenePath && ProjectorPlugin._scenePath.startsWith(`/${ProjectorPlugin.kind}`)) {
                    // 只有从 ppt 切到非 ppt 时才需要 unmount
                    this.unmountSlide();
                }
            } else {
                const uuid = state.sceneState.scenePath.split("/")[2];
                const slideIndex = state.sceneState.scenePath.split("/")[3];
                const currentSlideUUID = this.attributes["currentSlideUUID"];
                console.log("currentSlideUUID ", currentSlideUUID, JSON.stringify(this.attributes[currentSlideUUID]));
                
                if (currentSlideUUID && this.attributes[currentSlideUUID]) {
                    const slideState = this.attributes[currentSlideUUID] as SlideState;
                    if (slideState.taskId !== uuid || slideState.currentSlideIndex !== parseInt(slideIndex)) {
                        // scenePath 与 slideState 对不上，以 slidestate 为准
                        await this.restoreSlideByState(slideState);
                        // TODO 从非 ppt 页跳转到 ppt 页会卡在这一步
                    }
                } else {
                    // 当场景切换到 ppt 页时，如果没有读取到云端 slidestate 只可能是一种情况：某个用户刚好创建 slide，但是 slidestate 还没有更新到云端，这时候根据 index 先渲染
                    // 由于已经进入了房间，可以监听到所有用户的事件，因此状态肯定可以同步
                    if (ProjectorPlugin.currentSlideManager) {
                        await ProjectorPlugin.currentSlideManager.renderSlide(parseInt(slideIndex));
                    }
                    // throw new Error("[Projector plugin] slide state not initiated");
                }
            }
            ProjectorPlugin._scenePath = state.sceneState.scenePath;
        }
    }

    // 恢复 slide，如果 currentSlideUUID 不存在则证明 slide 没有初始化
    private restoreSlideByState = async (slideState: SlideState): Promise<void> => {
        ProjectorPlugin.logger.info(`[Projector plugin] restore slide by state ${JSON.stringify(slideState)}}`);
        
        if (!ProjectorPlugin.currentSlideManager) {
            ProjectorPlugin.currentSlideManager = new ProjectorSlideManager(this);
            await ProjectorPlugin.currentSlideManager.initSlide();
        }
        ProjectorPlugin.currentSlideManager.setResource(slideState.taskId, slideState.url);
        ProjectorPlugin.currentSlideManager.setSlideState(slideState);
        if (isRoom(this.displayer) && this.displayer.isWritable) {
            const scenePath = `/${ProjectorPlugin.kind}/${slideState.taskId}/${slideState.currentSlideIndex}`;

            ProjectorPlugin.logger.info(`[Projector plugin] scenePath change to ${scenePath}`);
            this.displayer.setScenePath(scenePath);
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
        if (ProjectorPlugin.currentSlideManager) {
            ProjectorPlugin.logger.info(`[Projector plugin] unmount slide object`);
            ProjectorPlugin.currentSlideManager.destory();

            ProjectorPlugin.currentSlideManager = undefined;

            this.setAttributes({
                currentSlideUUID: undefined,
            });
        }
    }

    private async putWhiteboardScenes(uuid: string, slideCount: number): Promise<void> {
        const room = (this.displayer as Room);
        const scenes = new Array(slideCount).fill('').map((_, index) => {
            return {
                name: `${index + 1}`,
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

    public init = async (): Promise<void> => {
        const scenePath = this.displayer.state.sceneState.scenePath;
        ProjectorPlugin._scenePath = scenePath;
        
        this.displayer.addMagixEventListener(SLIDE_EVENTS.syncDispatch, this.whiteboardEventListener, {
            fireSelfEventAfterCommit: true,
        });
        ProjectorPlugin._emitter.once(ProjectorEvents.DisplayerDidMount, this.wrapperDidMountListener);
        this.displayer.callbacks.on(this.callbackName as any, this.roomStateChangeListener);
        // ProjectorDisplayer is create before ProjectorPlugin instance，DisplayerDidMount callback may not be fired
        // Call the method once to make sure the state is correct
        this.onApplianceChange();
        
        // 如果用户是中途加入房间，由于 roomStateChangeListener 无法监听到刚进入房间时的 scenepath 变化，因此如果刚进入房间时是 ppt 页面，就尝试通过 currentSlideUUID 恢复，然后跳转
        if (scenePath.startsWith(`/${ProjectorPlugin.kind}`)) {
            const currentSlideUUID = this.attributes["currentSlideUUID"];
            if (currentSlideUUID && this.attributes[currentSlideUUID]) {
                const slideState = this.attributes[currentSlideUUID] as SlideState;
                await this.restoreSlideByState(slideState);
            } else {
                throw new Error("[Projector plugin] current slide not initiated");
            }
        }
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
                    throw new Error("[Projector plugin] room is not writable");
                }
                projectorPlugin = (await displayer.createInvisiblePlugin(
                    ProjectorPlugin,
                    {}
                )) as ProjectorPlugin;
            } else {
                throw new Error("[Projector plugin] plugin only working on writable room")
            }
        }
        await projectorPlugin.init();
        return projectorPlugin;
    }

    /**
     * create a slide and jump to frist page.
     * if the slide has already been created，it will clear whiteboard contents of the corresponding scnen
     * */ 
    public async createSlide(option: ProjectorSlideOption): Promise<void> {
        const slideManager = await this.refreshCurrentSlideManager(option.uuid, option.prefix);
        
        const slideCount = await slideManager.getSlideCount();
        await this.putWhiteboardScenes(option.uuid, slideCount);
        
        this.setAttributes({
            currentSlideUUID: option.uuid,
        });

        await slideManager.renderSlide(1);
    }

    // change to a created slide
    public async changeSlide(uuid: string, slideIndex?: number): Promise<void> {
        const slideState = this.attributes[uuid] as SlideState;
        if (slideState) {
            const slideManager = await this.refreshCurrentSlideManager(slideState.taskId, slideState.url);
            if (slideIndex) {
                slideManager.renderSlide(slideIndex);
            } else {
                slideManager.setSlideState(slideState);
            }
            
            this.setAttributes({
                currentSlideUUID: slideState.taskId,
            });
            let index = 1;
            if (slideIndex) {
                index = slideIndex;
            } else {
                if (slideState.currentSlideIndex && slideState.currentSlideIndex !== -1) {
                    index = slideState.currentSlideIndex;
                }
            }
            
            await this.jumpToScene(slideState.taskId, index);
        } else {
            throw new Error("[Projector plugin] slide not created");
        }
    }

    private refreshCurrentSlideManager = async (uuid: string, prefix: string): Promise<ProjectorSlideManager> => {
        const slideManager = new ProjectorSlideManager(this);
        await slideManager.initSlide();
        slideManager.setResource(uuid, prefix);
        if (ProjectorPlugin.currentSlideManager) {
            // destroy manager to avoid multiple slide instances
            ProjectorPlugin.currentSlideManager.destory();
        }
        ProjectorPlugin.currentSlideManager = slideManager;
        ProjectorPlugin.logger.info(`[Projector plugin] refresh currentSlideManager object`);
        return ProjectorPlugin.currentSlideManager;
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

    /**
     * delete slideState and slide scenePath
     * return false if delete motion failed.
     * can not delete slide if current slide is target.
     */
    public deleteSlide(uuid: string): boolean {
        if (isRoom(this.displayer)) {
            const scenePathItem = this.displayer.state.sceneState.scenePath.split("/");
            const uuidInScenePath = scenePathItem[2];
            if (uuid === uuidInScenePath ||
                uuid === this.attributes["currentSlideUUID"] ||
                uuid === ProjectorPlugin.currentSlideManager?.slide?.slideState.taskId) {
                ProjectorPlugin.logger.error(`[Projector plugin] can not delete this slide because target is rendering`);
                return false;
            } else {
                this.displayer.removeScenes(`${ProjectorPlugin.kind}/${uuid}`);
                this.setAttributes({
                    [uuid]: undefined
                });
                return true;
            }
        } else {
            ProjectorPlugin.logger.error(`[Projector plugin] can not do this operation in replay`);
            return false;
        }
    }

    /**
     * List all tasks with first page preview
     */
    public async listSlidesWithPreview(): Promise<{
        uuid: string,
        slidePreviewImage?: string
    }[]> {
        const keys = Object.keys(this.attributes);
        const currentSlideUUIDIndex = keys.indexOf("currentSlideUUID");
        const uuidList = keys.splice(currentSlideUUIDIndex, 1);
        const slides = [];
        for (let index = 0; index < uuidList.length; index++) {
            const uuid = uuidList[index];
            const slideState = this.attributes[uuid] as SlideState;
            const slidePreviewImage = `${slideState.url}/${uuid}/preview/1.png`;
            const previewExist = await isFileExist(slidePreviewImage);
            if (previewExist) {
                slides.push({
                    uuid,
                    slidePreviewImage
                });
            } else {
                slides.push({
                    uuid,
                });
            }
        }
        return slides;
    }

    /**
     * List preview images of specified task
     */
    public async listSlidePreviews(uuid: string): Promise<string[]> {
        const previews: string[] = [];
        const slideState = this.attributes[uuid] as SlideState;
        if (slideState) {
            const slideCount = await getslideCount(uuid, slideState.url);
            for (let index = 0; index < slideCount; index++) {
                const previewUrl = `${slideState.url}/${uuid}/preview/${index}.png`;
                previews[index] = previewUrl;
            }
        } 
        return previews;
    }
}