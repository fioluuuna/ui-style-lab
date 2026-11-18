# 样稿外壳与播放器约定

起步：把 `templates/` 里三个文件复制到本轮目录，`starter.html` 改名为方向页，换掉 `.hero` 和 `.dS` 里的风格。

## 一轮样稿的目录

```
research/uiNN/
  index.html      总览：现状问题、共同结构、方向卡片（iframe ?shot 缩略图）、成品模板、参考、待决定
  a.html b.html   每个方向一页（融合轮可以只有 index.html）
  cards.html      分享图模板、视频分镜（需要时）
  proto.css proto.js
  assets/         真实渲染、序列帧、现状截图、对比图
  shots/          说明文档用的截图
  tools/          本轮在应用页面里用过的注入脚本
  说明.md
```

预览：`python3 -m http.server <端口> --bind 127.0.0.1 --directory research/uiNN`。需要并排比较时，可使用不同端口；发布文档中的页面链接使用可移植的相对路径。

## 方向页结构

```html
<header class="topbar">… <span class="chip">待确认试作 · 未采纳</span></header>
<div class="lab">
  <div class="stage-col">
    <div class="phone-wrap">
      <div class="phone dB" data-variants="day" data-variant-labels='{"base":"暗场","day":"亮场"}'>
        <section class="scr s1" data-name="开场" data-hold="3600">…</section>
        <section class="scr s2 lit" data-name="配花" data-hold="4200">…</section>
      </div>
    </div>
    <div class="ctrl"></div>          <!-- proto.js 自动填：变体切换、播放、逐屏、重播 -->
    <p class="hint">…</p>
  </div>
  <article class="notes">概念、关键词、转场表、强项风险、待判断</article>
</div>
<section class="strip-sec">
  <h3>暗场</h3><div class="strip"></div>
  <h3>亮场</h3><div class="strip" data-variant="day"></div>   <!-- 每个 .strip 自动克隆全部屏 -->
</section>
<script src="proto.js"></script>
```

## 播放器约定（proto.js）

| 约定 | 作用 |
|---|---|
| `.scr.on` | 当前屏；进场动画都挂在 `.dX .s2.on .el` 上 |
| `.scr.off` | 离场屏，保留 `--leave` 毫秒（写在 `.phone` 上，默认 900），在上层播离场动画 |
| `.phone.via` | 通过切换进入（不是首屏或重播）。用它给进场屏更长的 `--ed`，等离场动画播完：`.dB.via .s2{--ed:.55s}` |
| `--ed` | 进场基准延迟，所有进场动画写成 `calc(var(--ed) + .3s)` |
| `data-hold` | 播放全流程时这屏停多久（毫秒） |
| `data-go="next"` / `data-go="2"` | 画面内可点的元素，前进或跳到某屏（从 0 开始） |
| `?shot=N` | 只渲染第 N 屏的终态，给总览页 iframe 缩略图 |
| `?day=1` | 打开时直接用某个变体 |
| `.static` | 关掉所有动画，五屏一览和缩略图用 |
| `window.__lab` | `go(i)`、`replay()`、`setVariant(v)`、`screens`，给冻结截图等脚本用 |
| 键盘 | ← → 切屏，空格播放或停止 |

**基础样式写终态。** 进场动画只写 `from`（或 `from`、`to`），加 `both`。这样 `.static` 关掉动画后，缩略图和 `?shot` 截图就是终态，不需要另写一套样式。离场屏的计时器存在 `screen._t` 上。

## 变体

方向内还有分歧时（暗场 / 亮场、两种进度写法），做成变体而不是新页面：`data-variants="day"`，变体样式全部写在 `.dB.day …` 下。播放器给 `.phone` 切 class，控制条上出现切换按钮，五屏一览每个变体一行。

## 桌面画板

```html
<div class="desk-wrap"><div class="desk dB"><div class="full lit">…1440×900 的布局…</div></div></div>
```

proto.js 按容器宽度缩放；窄屏时变成 100% 宽、16:10。

## 序列帧

- 包装、生长这类一次性动作：`.sprite.play`，设 `--sprite:url(...)`、`--frames:8`，进场后按 `steps(帧数, jump-none)` 播一遍。帧数 N 对应 `steps(N, jump-none)`，正好落在 N 个整帧上。
- 转台：`.tt`，`--sprite`、`--frames:17`（网格序列帧再加 `--cols:7`），`data-front`（停在哪帧）、`data-delay`、`data-swing`。proto.js 用两层交叉淡化；平滑程度由相邻帧转角、播放速度、素材轮廓和显示尺寸共同决定，需实际预览，见 real-renders.md。
- 每帧要用同一个取景框渲染（见 real-renders.md），否则播放时画面跳动。

## 字体

样稿可以用 macOS 自带字体（苹方、SF Mono、Avenir Next Condensed、宋体、Didot），在说明里写明其他系统会回退。正式版用自托管、裁剪过的开源字体，上线前确认授权。
