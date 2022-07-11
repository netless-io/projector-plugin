import type { ProjectorPlugin} from "../src";
import { ProjectorDisplayer } from "../src";
import type { Room } from "white-web-sdk";

export const bindControlPanel = (plugin: ProjectorPlugin, room: Room): void => {
    document.getElementById("btn_insert")!.onclick = () => insertSlide(plugin);
    document.getElementById("btn_prevstep")!.onclick = () => prevStep(plugin);
    document.getElementById("btn_nextstep")!.onclick = () => nextStep(plugin);
    document.getElementById("btn_delete")!.onclick = () => deleteSlide(plugin);
    document.getElementById("btn_list")!.onclick = () => listSlide(plugin);
    document.getElementById("btn_scene_path")!.onclick = () => changeScenePath(room);
}

function insertSlide(plugin: ProjectorPlugin): void {
    const uuid = (document.getElementById("insert_uuid") as HTMLInputElement)?.value;
    const prefix = (document.getElementById("insert_prefix") as HTMLInputElement)?.value;
    if (!uuid || !prefix) {
        alert("param error");
    } else {
        plugin.createSlide({uuid, prefix});
    }
}

function prevStep(plugin: ProjectorPlugin) {
    plugin.prevStep();
}

function nextStep(plugin: ProjectorPlugin) {
    plugin.nextStep();
}

function deleteSlide(plugin: ProjectorPlugin) {
    const uuid = (document.getElementById("delete_uuid") as HTMLInputElement)?.value;
    if (!uuid) {
        alert("param error");
    } else {
        plugin.deleteSlide(uuid);
    }
}

function cleanPreviewPanel() {
    const previewPanel = document.getElementById("previewpanel");
    while(previewPanel?.children.item(0)) {
        previewPanel?.children.item(0)?.remove();
    }
}

async function listSlide(plugin: ProjectorPlugin) {
    cleanPreviewPanel();
    const slides = await plugin.listSlidesWithPreview();
    const previewPanel = document.getElementById("previewpanel");
    if (previewPanel) {
        slides.forEach(slide => {
            previewPanel.appendChild(renderSlidelist(plugin, slide.uuid, slide.slidePreviewImage));
        });
    }
}

// render slides with preview
function renderSlidelist(plugin: ProjectorPlugin, uuid: string, imageSrc?: string) {
    const frame = document.createElement("div");
    frame.className = "slide_preview_frame";
    frame.onclick = (event) => onSlidePreviewClick(plugin, event);
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

function renderPagePreviewlist(plugin: ProjectorPlugin, uuid: string, index: number, imageSrc?: string) {
    const frame = document.createElement("div");
    frame.className = "slide_preview_frame";
    frame.onclick = (event) => onPagePreviewClick(plugin, event);
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

// list preview images for one slide
async function listSlidePreview(plugin: ProjectorPlugin, uuid: string): Promise<void> {
    cleanPreviewPanel();
    const previews = await plugin.listSlidePreviews(uuid);
    const previewPanel = document.getElementById("previewpanel");
    previews.forEach((preview, index) => {
        previewPanel?.appendChild(renderPagePreviewlist(plugin, uuid, index + 1, preview));
    })
    
}

async function onSlidePreviewClick(plugin: ProjectorPlugin, event: MouseEvent): Promise<void> {
    const uuid = event.target?.parentElement.id;
    await plugin.changeSlide(uuid);
    await listSlidePreview(plugin, uuid);
}

async function onPagePreviewClick(plugin: ProjectorPlugin, event: MouseEvent): Promise<void> {
    const uuidAndIndex = event.target?.parentElement.id;
    const [uuid, index] = uuidAndIndex.split("_");
    await plugin.renderSlidePage(index);
}

async function changeScenePath(room: Room) {
    const scenePath = (document.getElementById("scene_path") as HTMLInputElement)?.value;
    cleanPreviewPanel();
    room.setScenePath(scenePath);
}
