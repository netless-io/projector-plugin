
import type { Room} from "white-web-sdk";
import { WhiteWebSdk } from "white-web-sdk";
import type { ProjectorError} from "@netless/projector-plugin";
import {ProjectorDisplayer, ProjectorPlugin} from "@netless/projector-plugin";
import "./index.css";
import { ControlPanel } from "./controlPanel";

const whiteBoardAppientirId = ""
const whiteBoardSDKToken = ""
const debugRoomId = "";
const debugRoomToken = "";

const whiteboard = new WhiteWebSdk({
    appIdentifier: whiteBoardAppientirId,
    useMobXState: true,
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

  const appDiv = document.getElementById("root");
  if (appDiv) {
    room.bindHtmlElement(appDiv as HTMLDivElement);
  }
  console.log("start init plugin");
  const controlPanel = new ControlPanel();

  const projectorPlugin = await ProjectorPlugin.getInstance(room, {
    logger: {
      info: console.log,
      error: console.error,
      warn: console.warn,
    },
    callback: {
      errorCallback: (e: ProjectorError) => {console.error(e)}
    }
  });
  if (!projectorPlugin) {
    alert("something wrong when create plugin!")
  } else {
    controlPanel.setup(projectorPlugin, room);
    (window as any).projector = projectorPlugin;
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
    disableNewPencil: false,
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
