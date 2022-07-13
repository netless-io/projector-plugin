import type { ProjectorPlugin} from "../src";
import type { Room } from "white-web-sdk";

export class ControlPanel {
    private plugin?: ProjectorPlugin;
    private room?: Room;
    public slidePreivewUUID?: string;

    constructor () {
        document.getElementById("btn_insert")!.onclick = () => this.insertSlide();
        document.getElementById("btn_prevstep")!.onclick = () => this.prevStep();
        document.getElementById("btn_nextstep")!.onclick = () => this.nextStep();
        document.getElementById("btn_delete")!.onclick = () => this.deleteSlide();
        document.getElementById("btn_list")!.onclick = () => this.listSlide();
        document.getElementById("btn_scene_path")!.onclick = () => this.changeScenePath();
    }

    private cleanPreviewPanel = (): void => {
        const previewPanel = document.getElementById("previewpanel");
        while(previewPanel?.children.item(0)) {
            previewPanel?.children.item(0)?.remove();
        }
        this.slidePreivewUUID = undefined;
    }

    // render slides with preview
    private renderSlidelist = (uuid: string, imageSrc?: string): HTMLDivElement => {
        const frame = document.createElement("div");
        frame.className = "slide_preview_frame";
        frame.onclick = this.onSlidePreviewClick;
        frame.id = uuid;

        const image = document.createElement("img");
        image.className = "slide_preview_img";
        if (imageSrc) {
            image.src = imageSrc;
        } else {
            image.src = ""
            image.style.height = "100px";
            image.alt = "no preview for this slide";
        }

        const text = document.createElement("div");
        text.className = "slide_preview_text";
        text.textContent = uuid;

        frame.appendChild(image);
        frame.appendChild(text);
        return frame;
    }

    private onSlidePreviewClick = async (event: MouseEvent): Promise<void> => {
        const uuid = event.target?.parentElement.id;
        await this.plugin?.changeSlide(uuid);
        await this.listSlidePreview(uuid);
    }

    private onPagePreviewClick = async (event: MouseEvent): Promise<void> => {
        const uuidAndIndex = event.target?.parentElement.id;
        const [uuid, index] = uuidAndIndex.split("_");
        await this.plugin?.renderSlidePage(index);
    }

    private renderPagePreviewlist = (uuid: string, index: number, imageSrc?: string): HTMLDivElement => {
        const frame = document.createElement("div");
        frame.className = "slide_preview_frame";
        frame.onclick = (event) => this.onPagePreviewClick(event);
        frame.id = `${uuid}_${index}`;
    
        const image = document.createElement("img");
        image.className = "slide_preview_img";
        if (imageSrc) {
            image.src = imageSrc;
        } else {
            image.src = ""
            image.style.height = "100px";
            image.alt = "no preview for this page";
        }
    
        const text = document.createElement("div");
        text.className = "slide_preview_text";
        text.textContent = `${index}`;
    
        frame.appendChild(image);
        frame.appendChild(text);
        return frame;
    }

    setup = (plugin: ProjectorPlugin, room: Room): void => {
        this.plugin = plugin;
        this.room = room
    }

    insertSlide = async (): Promise<void> => {
        const uuid = (document.getElementById("insert_uuid") as HTMLInputElement)?.value;
        const prefix = (document.getElementById("insert_prefix") as HTMLInputElement)?.value;
        if (!uuid || !prefix) {
            alert("param error");
        } else {
            await this.plugin?.createSlide({uuid, prefix});
        }
    }

    prevStep = (): void => {
        this.plugin?.prevStep();
    }

    nextStep = (): void => {
        this.plugin?.nextStep();
    }

    deleteSlide = (): void => {
        const uuid = (document.getElementById("delete_uuid") as HTMLInputElement)?.value;
        if (!uuid) {
            alert("param error");
        } else {
            this.plugin?.deleteSlide(uuid);
        }
    }

    listSlide = async (): Promise<void> => {
        this.cleanPreviewPanel();
        const slides = await this.plugin?.listSlidesWithPreview();
        const previewPanel = document.getElementById("previewpanel");
        if (previewPanel) {
            slides?.forEach(slide => {
                previewPanel.appendChild(this.renderSlidelist(slide.uuid, slide.slidePreviewImage));
            });
        }
    }

    // list preview images for one slide
    listSlidePreview = async (uuid: string): Promise<void> => {
        this.cleanPreviewPanel();
        const previews = await this.plugin?.listSlidePreviews(uuid);
        const previewPanel = document.getElementById("previewpanel");
        previews?.forEach((preview, index) => {
            previewPanel?.appendChild(this.renderPagePreviewlist(uuid, index + 1, preview));
        });
        this.slidePreivewUUID = uuid;
    }

    changeScenePath = (): void => {
        const scenePath = (document.getElementById("scene_path") as HTMLInputElement)?.value;
        this.cleanPreviewPanel();
        this.room?.setScenePath(scenePath);
    }
}
