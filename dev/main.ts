import type { Room } from "white-web-sdk";
import { DeviceType, WhiteWebSdk } from "white-web-sdk";
import { ProjectorPlugin, ProjectorDisplayer } from "../src";

const whiteBoardAppientirId = "";
const whiteBoardSDKToken = "";
const debugRoomId = "";
const debugRoomToken = "";
const devTaskUUID = "";
const devTaskPrefix = "";

const whiteboard = new WhiteWebSdk({
  appIdentifier: whiteBoardAppientirId,
  useMobXState: true,
  deviceType: DeviceType.Surface,
  invisiblePlugins: [ProjectorPlugin],
  wrappedComponents: [ProjectorDisplayer]
});

main();

async function main(): Promise<void> {
  const roomUUID = debugRoomId;
  const roomToken = debugRoomToken;
  const room = await (roomUUID && roomToken
    ? joinRoom(roomUUID, roomToken)
    : createRoom());
  (window as any).room = room;
  
  document.getElementById("btn")!.onclick = async () => {
    let plugin = room.getInvisiblePlugin(ProjectorPlugin.kind) as
    | ProjectorPlugin
    | undefined;
    if (!plugin) {
      // 该插件全局应该只有一个
      const projectorPlugin = new ProjectorPlugin({ kind: ProjectorPlugin.kind, displayer: room}, {
        logger: {
          info: console.log,
          error: console.error,
          warn: console.warn,
        }, 
        callback: {
          errorCallback: (e: Error) => console.error(`catch ${e.stack}`)
        },
        enableClickToNextStep: true,
      });
      plugin = projectorPlugin;
    }
    await plugin.initSlide(room, devTaskUUID, devTaskPrefix);
    (window as any).projector = plugin;
  
    bindKey(plugin);
  }

  const appDiv = document.getElementById("app")
  if (appDiv) {
    room.bindHtmlElement(appDiv as HTMLDivElement);
  }
}

async function createRoom(): Promise<Room> {
  const { uuid } = await post<{ uuid: string }>("rooms", {
    limit: 0,
    isRecord: false,
  });
  const roomToken = await post<string>(`tokens/rooms/${uuid}`, {
    lifespan: 0,
    role: "admin",
  });
  
  localStorage.setItem("roomUUID", uuid);
  localStorage.setItem("roomToken", roomToken);
  return joinRoom(uuid, roomToken);
}

async function joinRoom(roomUUID: string, roomToken: string): Promise<Room> {
  const uid = "uid";
  return whiteboard.joinRoom({
    uuid: roomUUID,
    roomToken,
    uid,
    invisiblePlugins: [ProjectorPlugin],
    disableMagixEventDispatchLimit: true,
    userPayload: {
      uid,
      nickName: uid,
    },
  });
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`https://api.netless.link/v5/${path}`, {
    method: "POST",
    headers: {
      token: whiteBoardSDKToken,
      region: "cn-hz",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return response.json();
}

/**
 * 绑定键盘事件
 */
function bindKey(projectorPlugin: ProjectorPlugin): void {
  banScroll();
  document.onkeydown = (event) => {
    if (event.code === "ArrowLeft") {
      projectorPlugin.prevStep();
    };
    if (event.code === "ArrowRight") {
      projectorPlugin.nextStep();
    };
  }
}

function banScroll(){ 
    document.body.addEventListener('touchmove', (event) => event.preventDefault(), { passive: false });
}