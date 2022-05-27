export const delay = (value: number) => new Promise(resolve => setTimeout(resolve, value));

export async function waitUntil(fn: () => boolean, timeout: number): Promise<void> {
    const start = Date.now();
    while (!fn() && Date.now() - start < timeout) {
        await delay(50);
    }
}