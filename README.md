# Projector-plugin

该项目基于 @netless/slide 进行开发，将 @netless/slide 与作为白板插件进行封装，所有状态都交由白板进行同步以实现各用户间的状态同步，同时保持 ppt 页面与白板页面翻页同步。

## 原理
PPT 内部操作（上一步、下一步、跳页）-> 得到 ppt 事件和即将变化的 state -> 通过白板状态回调设置全局 state -> 通过白板事件 api 发送操作事件 -> 接到事件调用 slide api 传入事件

PPT 中途进入操作 -> 初始化时读取全局 state -> 根据全局 state 的 uuid 等新建并渲染 slide 对象

当插入 PPT 时，插件会同时对白板房间进行插入场景操作，每一页 ppt 对应一个场景，场景路径为 `/projector-plugin/#{taskuuid}/#{index}`，这是为了让用户在白板上对 ppt 的标注或画笔能够对应每一页 ppt 的内容。
该插件会垫在白板底部，一个房间同时只会存在一个插件实例，当用户对 ppt 进行翻页操作时会触发房间的场景切换操作，同时场景切换时也会触发 ppt 的翻页操作。

## 用法
### 初始化:

```js
import type { Room} from "white-web-sdk";
import { WhiteWebSdk } from "white-web-sdk";
import type { ProjectorError} from "@netless/projector-plugin";
import {ProjectorDisplayer, ProjectorPlugin} from "@netless/projector-plugin";

const room = await createRoom();    // 使用 white sdk 创建的房间实例，需要自己实现

const whiteboard = new WhiteWebSdk({    // 在实例化 sdk 时将注册插件
    appIdentifier: whiteBoardAppientirId,
    useMobXState: true, // 必须需开启该选项，Projector plugin 才可以正常工作
    invisiblePlugins: [ProjectorPlugin],
    wrappedComponents: [ProjectorDisplayer]
});

const projectorPlugin = await ProjectorPlugin.getInstance(room, {   // 获取插件实例，全局应该只有一个插件实例
    logger: {   // 自定义日志，可选，如果不传则使用 console api
        info: console.log,
        error: console.error,
        warn: console.warn,
    },
    callback: { // 回调，可选参数
        onSlideRendered: (uuid: string, index: number) => {},   // 渲染回调，当页面渲染完成会触发，返回当前页的任务 uuid 和页面 index，可以在该回调中实现页码变化功能
        errorCallback: (e: ProjectorError) => {}  // 异常回调，如果不实现则会默认输出异常信息到控制台
    }
});

```
### API 说明
用户上传 ppt/pptx 文档转换成功后，会生成一系列的 json 文件和资源文件，@netless/slide 会将这些资源渲为 slide 对象，slide 的渲染效果会尽量靠近原版 ppt 文档。
插件内部只会以 uuid 作为唯一标识，用户需要自己记录 ppt 文档名称与 uuid 的对应关系。
#### 创建 slide 对象
用户需要在确保任务转换成功后才能够创建 slide 对象，创建后会自动跳转到 slide 第一页。用户创建后的 slide 会记录在插件状态中，可以随时切换。创建的 slide 会横向或者纵向填满白板的视窗。
如果在已经创建过同个 uuid 的 slide 的情况下再次调用创建，那么 slide 的状态和对应白板页面上的所有内容会被清空。
```js
projectorPlugin.createSlide({
    uuid: string,   // 转换任务成功后，结果中获取的 uuid
    prefix: string,     // 转换任务成功后，结果中获取的 prefix
}): Promise<void>;
```

#### 切换已经创建过的 slide 对象
切换 slide 对象时会恢复离开该 slide 时的状态，包括动画步骤和页码。切换后的 slide 会横向或者纵向填满白板的视窗。
```js
projectorPlugin.changeSlide(uuid: string): Promise<void>;
```

#### 切换当前 slide 的页码
切页后的 slide 会横向或者纵向填满白板的视窗。
```js
projectorPlugin.renderSlidePage(index: number): Promise<void>;
```

#### 动画播放:
动画播放本身可以点击 slide 内容，也可以通过调用方法来触发播放(有触发器的动画还是要点击才能播放)，动画 api 在当前页没有动画或动画全部播放完成时会触发翻页动作，同时触发白板翻页。
需要注意不要调用 room.setScenePath 来进行 slide 的翻页，插件会强制将白板页码与 slide 页码对齐，会让 setScenePath 翻页无效。

```js
projectorPlugin.nextStep(): void    // 动画下一步
projectorPlugin.prevStep(): void；    // 动画上一步
```

#### 删除 slide
删除指定的 slide 对象状态和对应白板页面。无法删除正在展示的 slide，必须切换到其他 slide 后才能删除。
slide 存在且删除成功会返回 true，否则返回 false。
```js
projectorPlugin.deleteSlide(uuid: string): boolean;
```

#### 列出当前房间存在的所有 slide
slide 的预览图是使用该 slide 第一页的缩略图，如果转换时没有选择生成预览图，那么 slidePreviewImage 字段将不存在。
```js
projectorPlugin.listSlidesWithPreview(): Promise<{
    uuid: string,   // slide uuid
    slidePreviewImage?: string  // slide 预览图，可能不存在
}[]>
```

#### 列出指定 slide 的所有预览图
返回结果为按照页码排序的 url 数组，如果转换时没有选择生成预览图，那么返回空数组。
```js
projectorPlugin.listSlidePreviews(): Promise<string[]>
```