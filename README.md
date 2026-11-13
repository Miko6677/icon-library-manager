# 图标库管理（Android）

这是一款通过 GitHub token 管理图标库的 Android 应用。连接后，应用会列出该 token 可访问的仓库，由你选择仓库；随后动态查找 `icon/` 或 `icons/` 下有效的 JSON 图标索引，由你选择要管理的独立索引。应用不预设仓库名称或 JSON 地址。

## 首次连接与 token 保存

在应用里输入有权访问目标仓库的 fine-grained personal access token。浏览需要读取权限；上传、删除或整理时需要 Contents 写权限。token 使用 Android Keystore 管理的 AES-GCM 密钥加密，并将密文存入应用私有空间。密钥保存在 Android Keystore，token 不会同步到云端或写入仓库。重新打开应用会尝试使用本机保存的 token 连接；按“断开并忘记”会删除本机保存的密文和密钥。

## 使用方式

底部导航提供“图标库 / 抠图 / 设置”三个入口。Token 与仓库选择集中在设置中，仓库列表始终由当前 Token 动态读取。图标库中，文件夹和 JSON 索引分区显示；文件夹可横向浏览，支持嵌套导航以及新建、重命名、移动、删除。每份 JSON 索引独立管理。

图标库的索引快照和公开图片缓存保存在本机，重新打开应用后可复用。手动刷新图标库或清理缓存后，会重新获取相应内容。

抠图页可直接从相册选一张照片；Android 13 及以上使用系统照片选择器，旧版本使用系统文档选择器，不申请广泛存储权限。图标库中也可选择一个或多个图片文件加入待上传列表。选择仓库和 JSON 索引后，可浏览图标并查看原始 URL。选择图片后可在提交前修改上传名称；抠图先用本机 IS-Net general-use q8 自动生成透明初始掩码（512 × 512 输入以降低手机峰值内存，边缘细节会比 1024 输入少）。需要精修时再点选主体或背景，按需启动 MobileSAM；也可用可调大小的擦除/恢复笔刷修整，并添加粗细可调的白色贴纸描边。最后可选择仅用原图、仅用透明抠图，或都不保存。模型推理与图片处理始终只在设备本机完成，用户图片不会发送到模型服务。

IS-Net q8 权重随 APK 打包（约 44.4 MB），来源及 Apache-2.0 许可证见 `app/src/main/assets/models/MODEL-NOTICE.txt` 和 `IS-NET-LICENSE.txt`。本项目没有 Android 设备或模拟器可用；布局通过 APK 内资源的手机尺寸预览检查，内存与效果仍需在目标手机上实测。

模型取舍参考：[Cloudflare 的公开对比](https://blog.cloudflare.com/background-removal/)中，BiRefNet-general 的平均 IoU/Dice 为 0.87/0.92，高于 IS-Net-general-use 的 0.82/0.89；但其 [ONNX 权重约 973 MB](https://huggingface.co/onnx-community/BiRefNet-ONNX/blob/main/onnx/model.onnx)，而 IS-Net q8 模型卡提供约 44.4 MB 的量化权重（原始 fp32 约 176 MB，Apache-2.0）。该对比基于 GPU 和指定数据集，不代表手机效果；此处优先选择更适合随 APK 和本机推理的轻量起点，再用 MobileSAM 的点选提示做可选精修。来源：[IS-Net q8 模型卡](https://huggingface.co/SacredNoir/isnet-general-use-onnx)、[MobileSAM 官方仓库](https://github.com/ChaoningZhang/MobileSAM)。

图标改名只更新所选索引的 `icons[].name`；分类改名只更新该 JSON 的顶层 `name`；图标 URL 保持可见。上移/下移排序仅暂存到当前 JSON。跨分类移动时，应用会从来源 JSON 的 `icons[]` 移除条目并添加到目标 JSON，同时把对应的单张图片文件从旧路径移到指定的图片目录，并更新目标 JSON 中的图片 URL。移动预览会显示来源与目标索引、图片旧/新路径；若目标路径冲突或图片仍被其他索引引用，会阻止迁移。文件夹管理与上传、改名、删除一样，都会先在本机暂存并展示影响范围；只有用户明确确认后才会写入 GitHub。开发和验证期间未对真实仓库执行写入。

设置支持简体中文/English，以及跟随系统、浅色、深色外观；偏好保存在本机。应用图标选择位于「设置 → 外观」，提供奶油香槟金、冰川蓝、樱花粉和深蓝鎏金四款原创棱镜切面图标；Android 8.0 及以上使用自适应前景/背景图层，Android 13 及以上提供单色图层，旧版使用圆形位图回退。桌面/应用抽屉选择会启用对应 launcher alias；应用「信息」固定使用奶油香槟金默认/圆形图标。图片裁切支持单指平移、双指缩放；预览采用低分辨率缓存，最终导出仍从原图按同一选区生成。支持 PNG、JPG/JPEG、GIF、WebP、AVIF；单个文件最大 12 MB，单次选择合计不超过 24 MB。GIF 抠图按首帧处理。

## 安装与构建

1.1.4 调试 APK：在 [GitHub Releases](https://github.com/Miko6677/icon-library-manager/releases/latest) 下载。APK 使用调试签名，适合个人测试。

需要 JDK 17 或更高版本和 Android SDK platform 35。在项目根目录执行：

```sh
./gradlew assembleDebug
```

APK 输出到 `app/build/outputs/apk/debug/app-debug.apk`。
