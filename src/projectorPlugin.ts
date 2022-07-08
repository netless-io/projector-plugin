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
import {  SLIDE_EVENTS } from "@netless/slide";
import { EventEmitter2 } from "eventemitter2";
import type { SlideState } from "./projectorSlideManager";
import { ProjectorSlideManager } from "./projectorSlideManager";
import { getslideCount, isFileExist } from "./util";
import { ProjectorError, ProjectorErrorType } from "./error";

export type Logger = {
    readonly info: (...messages: any[]) => void;
    readonly warn: (...messages: any[]) => void;
    readonly error: (...messages: any[]) => void;
}
export type ProjectorCallback = {
    errorCallback: (e: ProjectorError) => void;
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

type WhiteboardEventListener = (event: Event)=>void;

export class ProjectorPlugin extends InvisiblePlugin<ProjectorStateStore> {
    // a unique king, different from other plugins.
    public static readonly kind: string = "projector-plugin";
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
            return;
        }
        const { type, payload } = ev.payload;
        if (type === SLIDE_EVENTS.syncDispatch) {
            ProjectorPlugin.logger.info(`[projector pluin]: received event`);
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
            } else {
                ProjectorPlugin.logger.warn(`[projector pluin] currentSlideManager not ready`);
            }
        }
        // triggerd when user change appliance
        if (state.memberState) {
            if (ProjectorDisplayer.instance) {
                this.onApplianceChange();
            } else {
                ProjectorPlugin.logger.warn(`[projector pluin] ProjectorDisplayer not ready`);
            }
        }
        if (state.sceneState) {
            ProjectorPlugin.logger.info(`[Projector plugin] scene changed ${state.sceneState.scenePath}`);
            
            if (!state.sceneState.scenePath.startsWith(`/${ProjectorPlugin.kind}`)) {
                if (ProjectorPlugin._scenePath && ProjectorPlugin._scenePath.startsWith(`/${ProjectorPlugin.kind}`)) {
                    // only unmount when change scene from slide scene to non-slide scene
                    this.unmountSlide();
                }
            } else {
                const uuid = state.sceneState.scenePath.split("/")[2];
                const slideIndex = state.sceneState.scenePath.split("/")[3];
                const currentSlideUUID = this.attributes["currentSlideUUID"];
                
                if (currentSlideUUID && this.attributes[currentSlideUUID]) {
                    const slideState = this.attributes[currentSlideUUID] as SlideState;
                    if (slideState.taskId !== uuid || slideState.currentSlideIndex !== parseInt(slideIndex)) {
                        // if data in scenePath not same with data in slideState, data in slidestate always prevail
                        await this.restoreSlideByState(slideState);
                    }
                } else {
                    // When the scene switches to the slide page, if the cloud slidestate is not read, it may only be a situation:
                    //  a user just created a slide, but the slidestate has not been updated to the cloud, then the page is rendered first according to the index
                    //  and then the user has entered the room, the client can listen to the events of all users, so the state can definitely be synchronized
                    if (ProjectorPlugin.currentSlideManager) {
                        await ProjectorPlugin.currentSlideManager.renderSlide(parseInt(slideIndex));
                    } else {
                        ProjectorPlugin.logger.warn(`[projector pluin] currentSlideManager not ready`);
                    }
                }
            }
            ProjectorPlugin._scenePath = state.sceneState.scenePath;
        }
    }

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

    private getManagerInstance(): ProjectorSlideManager | undefined {
        if (ProjectorPlugin.currentSlideManager) {
            return ProjectorPlugin.currentSlideManager;
        } else {
            ProjectorPlugin.projectorCallbacks.errorCallback(new ProjectorError("[Projector plugin] can not find slideManager", ProjectorErrorType.RuntimeError));
            return undefined;
        }
    }

    /**
     * Throws an error when there is a problem
     * You can not create slide scene by room.putScenes(), Otherwise, the initialization will fail
     * Use createSlide() to create a slide and slide scenes
     * 
     * Return undefined if initialization failed
     */ 
    public static async getInstance(displayer: Displayer, adaptor?: ProjectorAdaptor): Promise<ProjectorPlugin | undefined> {
        if (adaptor?.logger) {
            ProjectorPlugin.logger = adaptor.logger;
        }
        if (adaptor?.callback) {
            ProjectorPlugin.projectorCallbacks = adaptor?.callback;
        }
        
        let projectorPlugin = displayer.getInvisiblePlugin(ProjectorPlugin.kind) as
            | ProjectorPlugin
            | undefined;
        if (!projectorPlugin) {
            if (isRoom(displayer) && displayer.isWritable) {
                if (!displayer.isWritable) {
                    ProjectorPlugin.projectorCallbacks.errorCallback(new ProjectorError("[Projector plugin] room is not writable", ProjectorErrorType.RuntimeError));
                    return undefined;
                }
                projectorPlugin = (await displayer.createInvisiblePlugin(
                    ProjectorPlugin,
                    {}
                )) as ProjectorPlugin;
            } else {
                ProjectorPlugin.projectorCallbacks.errorCallback(new ProjectorError("[Projector plugin] plugin only working on writable room", ProjectorErrorType.RuntimeError));
                return undefined;
            }
        }
        await projectorPlugin.init();
        return projectorPlugin;
    }

    private init = async (): Promise<void> => {
        const scenePath = this.displayer.state.sceneState.scenePath;
        ProjectorPlugin._scenePath = scenePath;
        
        this.displayer.addMagixEventListener(SLIDE_EVENTS.syncDispatch, this.whiteboardEventListener, {
            fireSelfEventAfterCommit: true,
        });
        ProjectorPlugin._emitter.once(ProjectorEvents.DisplayerDidMount, () => {
            this.onApplianceChange();
        });
        this.displayer.callbacks.on(this.callbackName as any, this.roomStateChangeListener);
        // ProjectorDisplayer is create before ProjectorPlugin instance，DisplayerDidMount callback may not be fired
        // Call the method once to make sure the state is correct
        this.onApplianceChange();
        
        // If the user joins the room in the middle, because the roomStateChangeListener cannot monitor the scenepath
        // change when the room is just entered, if the ppt page is when the room is just entered, try to restore it 
        // through currentSlideUUID, and then jump to that scene
        if (scenePath.startsWith(`/${ProjectorPlugin.kind}`)) {
            const currentSlideUUID = this.attributes["currentSlideUUID"];
            if (currentSlideUUID && this.attributes[currentSlideUUID]) {
                const slideState = this.attributes[currentSlideUUID] as SlideState;
                await this.restoreSlideByState(slideState);
            } else {
                ProjectorPlugin.logger.warn("[Projector plugin] current slide not initiated", ProjectorErrorType.RuntimeError);
            }
        }
    }

    /**
     * create a slide and slide scenes, then jump to frist slide page.
     * if the slide has already been created，it will clear whiteboard contents of the corresponding scnen
     * */ 
    public async createSlide(option: ProjectorSlideOption): Promise<void> {
        const slideManager = await this.refreshCurrentSlideManager(option.uuid, option.prefix);
        
        const pageCount = await slideManager.getSlidePageCount();
        await this.putWhiteboardScenes(option.uuid, pageCount);
        
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
            ProjectorPlugin.projectorCallbacks.errorCallback(new ProjectorError("[Projector plugin] slide not created", ProjectorErrorType.RuntimeError));
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

    public renderSlidePage(index: number): void {
        this.getManagerInstance()?.renderSlide(index);
    }

    public nextStep(): void {
        this.getManagerInstance()?.nextStep();
    }

    public prevStep(): void {
        this.getManagerInstance()?.prevStep();
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
    public deleteSlide = (uuid: string): boolean => {
        if (isRoom(this.displayer)) {
            const scenePathItem = this.displayer.state.sceneState.scenePath.split("/");
            const uuidInScenePath = scenePathItem[2];
            if (uuid === uuidInScenePath ||
                uuid === this.attributes["currentSlideUUID"] ||
                uuid === ProjectorPlugin.currentSlideManager?.slide?.slideState.taskId) {
                ProjectorPlugin.logger.error(`[Projector plugin] can not delete this slide because target is rendering`);
                return false;
            } else {
                console.log(`/${ProjectorPlugin.kind}/${uuid}`);
                this.displayer.removeScenes(`/${ProjectorPlugin.kind}/${uuid}`);
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
     * make sure storage bucket allow cross domain with GET & HEAD request
     */
    public listSlidesWithPreview = async (): Promise<{
        uuid: string,
        slidePreviewImage?: string
    }[]> => {
        const keys = Object.keys(this.attributes);
        const currentSlideUUIDIndex = keys.indexOf("currentSlideUUID");
        keys.splice(currentSlideUUIDIndex, 1);
        const slides = [];
        for (let index = 0; index < keys.length; index++) {
            const uuid = keys[index];
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
    public listSlidePreviews = async (uuid: string): Promise<string[]> => {
        const previews: string[] = [];
        const slideState = this.attributes[uuid] as SlideState;
        if (slideState) {
            const slideCount = await getslideCount(uuid, slideState.url);
            for (let index = 0; index < slideCount; index++) {
                const previewUrl = `${slideState.url}/${uuid}/preview/${index + 1}.png`;
                previews[index] = previewUrl;
            }
        } 
        return previews;
    }
}