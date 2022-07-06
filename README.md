# Projector-plugin

该项目基于 @netless/slide 进行开发，将 @netless/slide 与作为白板插件进行封装，所有状态都交由白板进行同步以实现各用户间的状态同步，同时保持 ppt 页面与白板页面翻页同步。

## 原理
PPT 内部操作（上一步、下一步、跳页）-> 得到 ppt 事件和即将变化的 state -> 通过白板状态回调设置全局 state -> 通过白板事件 api 发送操作事件 -> 接到事件调用 slide api 传入事件

PPT 中途进入操作 -> 初始化时读取全局 state -> 根据全局 state 的 uuid 等新建并渲染 slide 对象

当插入 PPT 时，插件会同时对白板房间进行插入场景操作，每一页 ppt 对应一个场景，场景路径为 `/projector-plugin/#{taskuuid}/#{index}`，这是为了让用户在白板上对 ppt 的标注或画笔能够对应每一页 ppt 的内容。
该插件会垫在白板底部，一个房间同时只会存在一个插件实例，当用户对 ppt 进行翻页操作时会触发房间的场景切换操作，同时场景切换时也会触发 ppt 的翻页操作。

## 用法
初始化:
```
const room = await createRoom();    // 用户需要自己创建房间实例
  
const projectorPlugin = new ProjectorPlugin({
    kind: ProjectorPlugin.kind, // 固定参数
    displayer: room,    // 固定参数
}, {     // 用户自定义日志对象，如果不传会使用 console 日志
    info: console.log,     
    error: console.error,
    warn: console.warn,
}, {     // 用户自定义回调对象，渲染中产生异常会调用该回调，如果不传会默认调用 console.error()
    errorCallback: (e: Error) => console.error(`catch ${e.stack}`),
});

await projectorPlugin.initSlide(room,
    devTaskUUID,    // 转换 ppt 获得的 uuid
    devTaskPrefix,  // 转换 ppt 获得的资源前缀
);
```

动画播放:
动画播放本身可以点击 ppt 内容，也可以通过调用方法来触发播放(有触发器的动画还是要点击才能播放)
```
projectorPlugin.nextStep()；    // 动画下一步
projectorPlugin.prevStep()；    // 动画上一步
```