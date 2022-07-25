# Projector-plugin

[【中文说明】](./README.zh-CN.md) 

The project is developed based on @netless/slide, which encapsulates @netless/slide as a whiteboard plugin. All states are synchronized by the whiteboard to achieve state synchronization between users, while maintaining the synchronization between the ppt page and the whiteboard page.

The example folder is the demo of the project, and users can refer to the demo to write business code.

## Principle
Slide operation (prevStep, nextStep, turn pages) -> Get events and upcoming slide state changes -> Set global slide state via whiteboard plugin attributes -> Send slide action events via whiteboard events api -> All users receive the event and call the local slide api to incoming event

Join the room midway -> Read global slide state on initialization via whiteboard plugin attributes -> Render slide  based on the global slide state

When inserting slide, the plugin will simultaneously insert the scene into the whiteboard room, Each page of slide corresponds to a scene, The scene path format is `/projector-plugin/#{taskuuid}/#{index}`, This is to allow the user's annotations or brushes on the slide on the whiteboard to correspond to the content of each page of slide. 

The plugin will be placed at the bottom of the whiteboard, and only one plugin instance will exist in a room at the same time. When the user performs a page-turning operation on slide, the scene switching operation of the room will be triggered. In order to ensure the synchronization effect of multiple clients, the page number of the whiteboard scene is based on the page number of ppt.

## Start in development mode
Starting directly in the root directory of the project runs the code in the dev folder, which is used for development.

Before starting, find the following content in the main.ts file under the dev folder and replace it with the user's own account information.
```js
const whiteBoardAppientirId = "";   // The whiteboard AppIdentifier obtained from the whiteboard configuration page of the agora console, we needs this value to create a whiteboard sdk instance
const whiteBoardSDKToken = "";  // The sdkToken generated on the whiteboard configuration page of agora console, we needs this value to create a whiteboard sdk instance
const debugRoomId = "";    // The created whiteboard room roomToken is used to join the room
const debugRoomToken = "";  // The created whiteboard room roomToken is used to join the room
```
### Pnpm
command of install pnpm
```
npm insatll -g pnpm
```
start up
```
pnpm i && pnpm start
```

### Yarn
```
yarn && yarn start
```

## Plugin usage
### Initialization

```js
import { Room, WhiteWebSdk } from "white-web-sdk";
import {ProjectorDisplayer, ProjectorPlugin, ProjectorError} from "@netless/projector-plugin";

const whiteboard = new WhiteWebSdk({    // Register the plugin when instantiating the sdk
    appIdentifier: whiteBoardAppientirId,   // The appIdentifier obtained from the the agora whiteboard console
    useMobXState: true,     // This option must be turned on for the Projector plugin to work properly
    invisiblePlugins: [ProjectorPlugin],
    wrappedComponents: [ProjectorDisplayer]
});

// TODO The method of creating a room using the white sdk needs to be implemented by yourself
const room = await whiteboard.joinRoom({
    uuid: roomUUID,
    roomToken,
    invisiblePlugins: [ProjectorPlugin],
    // ... TODO The rest of the configuration
});

const projectorPlugin = await ProjectorPlugin.getInstance(room, {   // Get the plugin instance, there should be only one plugin instance globally, it must be called after joinRoom
    logger: {   // Custom logger, optional, if not passed, use console api
        info: console.log,
        error: console.error,
        warn: console.warn,
    },
    callback: { // optional
        onSlideRendered: (uuid, index) => {},   // When the page is rendered, a callback will be triggered, and the task uuid and page index of the current page will be returned. The page number change function can be implemented in this callback. The index is instance of number type
        errorCallback: (error) => {}  // Exception callback, if not implemented, the exception information will be output to the console by default.
    }
});

```
### API reference
After the ppt/pptx document uploaded by the user is successfully converted, a uuid and a series of json files and resource files will be generated, @netless/slide will render these resources as slide objects, and the rendering effect of slide will be as close to the original ppt document as possible.

The plugin will only use uuid as a unique identifier, and users need to record the correspondence between the ppt/pptx document name and uuid.

When the user's whiteboard switches from a slide page to a non-slide page, the plugin will destroy the slide, When the user needs to go back to the slide page again, just call the `changeSlide` method.

#### Create slide
The user needs to ensure that the task conversion is successful before creating the slide object. After creation, it will automatically jump to the first page of the slide. The slide created by the user will be recorded in the plug-in state and can be switched at any time. The created slide will fill the whiteboard's viewport horizontally or vertically.

If you call create again when a slide with the same uuid has already been created, the state of the slide and all content on the corresponding whiteboard page will be cleared.
```js
projectorPlugin.createSlide({
    uuid: string,   // After the conversion task is successful, the uuid obtained in the response
    prefix: string,     // After the conversion task is successful, the prefix obtained in the response
}) => Promise<void>;
```

#### Toggle slide that has been created
Switching a slide restores the state it was in when you left the slide, including animation steps and page numbers. The toggled slide will fill the whiteboard's window horizontally or vertically.
```js
projectorPlugin.changeSlide(uuid: string) => Promise<void>;
```

#### Turn page of the current slide
The slide after the turning page will fill the whiteboard's window horizontally or vertically.
```js
projectorPlugin.renderSlidePage(index: number) => Promise<void>;
```

#### Play animation
When the ppt is animated, you can trigger the playback animation by calling the following method (the animation with the trigger needs to be clicked to play). The animation api will trigger the page turning action when there is no animation on the current page or when all the animations are played, and trigger the whiteboard page turning at the same time.

**Be careful not to call `room.setScenePath` to turn the slide page, the plug-in will force the whiteboard page number to align with the slide page number, which will invalidate the page turn triggered by setScenePath.**

```js
projectorPlugin.nextStep() => void;
projectorPlugin.prevStep() => void;
```

#### Delete slide
Deletes the specified slide object state and corresponding whiteboard page. The displayed slide cannot be deleted, it must be switched to another slide to delete it.

Returns true if slide exists and the deletion is successful, otherwise returns false.
```js
projectorPlugin.deleteSlide(uuid: string) => boolean;
```

#### List all slides that exist in the current room
The preview image of the slide is the thumbnail of the first page of the slide. If the preview image is not selected when the transition is initiated, the slidePreviewImage field will not exist.
```js
projectorPlugin.listSlidesWithPreview() => Promise<{
    uuid: string,   // slide uuid
    slidePreviewImage?: string  // slide preivw
}[]>;
```

#### List previews of all pages of the specified slide
The returned result is an array of urls sorted by page number. If no preview image is selected when the conversion is initiated, an empty array is returned.
```js
projectorPlugin.listSlidePreviews() => Promise<string[]>;
```
