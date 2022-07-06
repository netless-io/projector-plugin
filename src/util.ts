import { ProjectorPlugin } from "./projectorPlugin";

export const delay = (value: number): Promise<void> => new Promise(resolve => setTimeout(resolve, value));

export async function waitUntil(fn: () => boolean, timeout: number): Promise<void> {
    const start = Date.now();
    while (!fn() && Date.now() - start < timeout) {
        await delay(50);
    }
}

export async function isFileExist(url: string): Promise<boolean> {
    const http = new XMLHttpRequest();
    try {
        http.open('HEAD', url, false);
        http.send();
        if (http.status != 404) {
            http.abort();
            return true;
        } else {
            http.abort();
            return false;
        }
    } catch (e) {
        ProjectorPlugin.logger.error(`[Projector plugin] can not get file with error : ${(e as Error).stack}`);
        return false;
    }
}
    

export async function getslideCount(uuid: string, prefix: string): Promise<number> {
    try {
        const res = await fetch(`${prefix}/${uuid}/jsonOutput/slide-1.json`);
        const json = await res.json();
        return json.slideCount;
    } catch {
        return 0;
    }
    
}