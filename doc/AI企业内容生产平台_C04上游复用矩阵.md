# AI 企业内容生产平台：C04 上游复用矩阵

## 范围

C04 只实现 Asset、Shot、ReferenceBinding、服务端 object key、短期预签名上传/确认/下载和 Studio 工作台。`upstream/` 仍为本机忽略的溯源目录，不能进入平台 Git、submodule 或 gitlink。

| 目标模块 | 上游固定版本与文件/符号 | 迁入或保留内容 | 平台薄适配位置 | 舍弃原因与回归保护 |
| --- | --- | --- | --- | --- |
| Studio 资产预览 | huobao-drama `f04d705603bd0257bcec6b8f44fd04ea3ea9b795`；`frontend/app/composables/useMedia.ts` 的 `thumbFallback`，`frontend/app/views/drama/detail.vue` 的 `uploadingMaterials`、`isUploading`、`uploadMaterial` | 保留短生命周期预览、上传中禁用和图片加载失败回退的局部交互结构与变量语义 | `apps/studio-web/app/composables/useAssetMedia.ts`、`apps/studio-web/app/pages/index.vue`、`apps/control-api/tests/c04-studio-ui-e2e.py` | 不迁入 `/static/` 路径推导、短剧 material/character/scene 数据、`uploadAPI.image`、本地持久 URL 或 Provider 调用。测试断言 Studio 仅调用相对 `/api/v1`，不含 object key、MinIO、Provider 或 Veyra；受控浏览器 E2E 使用有效 1x1 PNG，刷新后断言 Preview `naturalWidth`/`naturalHeight` 均大于零并清理 fixture、screenshot、项目与 object。 |
| Asset 元数据质量门 | OpenMontage `4eab34c5cfcccaa4f1970554928feccce73ee930`；`schemas/artifacts/asset_manifest.schema.json` 的 `id/type/format/resolution/duration` 形状，`tests/contracts/test_phase0_contracts.py` 的 schema contract 验证习惯 | 复用“资产必须有可验证类型和技术元数据”的边界与测试质量门 | `packages/contracts/src/resources.ts`、`packages/storage-client/tests/`、`packages/persistence/tests/` | 不迁入 `path`、`source_tool`、`provider`、成本字段、Backlot/project directory 或 Python Runtime。平台以 `asset_id`、workspace/project、object key 和服务器验证后的 MIME/size/hash 为事实。 |
| 对象存储 | 无可安全迁入的上游 S3 实现；C01 的 MinIO Compose 只提供本地运行环境 | 新建可替换的 S3 兼容 StoragePort，采用 AWS SDK 的签名和 Head/Get Object 协议 | `packages/storage-client/` | 不在 Hono handler 手写 SigV4，不让浏览器读取 S3 管理凭据，不让 StoragePort 导入数据库、页面、Provider 或 Veyra。测试使用内存端口，真实 MinIO 验证只使用本地假值。 |

每个迁入模块通过 `UPSTREAM.md` 记录来源、保留变量、差异和回归命令。C04 不迁入 Huobao 的短剧 API、MySQL、媒体本地目录或进程内任务状态；不迁入 OpenMontage 的文件系统 Artifact 真相。
