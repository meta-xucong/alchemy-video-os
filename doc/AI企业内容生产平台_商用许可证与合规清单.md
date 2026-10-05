# 商用许可证与合规清单

此清单是发布阻断表，不是法律意见。当前项目仍为学习/本地研究阶段，未取得商业发布批准。

| 来源/组件 | 需核验 | 当前状态 | 放行证据 |
|---|---|---|---|
| huobao-drama | 代码、素材、依赖及其许可证 | `LEGAL_REVIEW_REQUIRED` | 固定 commit、SPDX、NOTICE、商业许可或替代方案 |
| Seedance-2.5 | 文档、提示词和模型服务条款 | `LEGAL_REVIEW_REQUIRED` | 服务条款、模型调用授权和公开分发边界 |
| markitdown | 包、依赖和许可证 | `LEGAL_REVIEW_REQUIRED` | lockfile、SPDX、NOTICE、漏洞报告 |
| OpenMontage | AGPLv3 及其依赖/运行方式 | `BLOCKED` | 法律确认网络服务/派生作品义务，或隔离并替换 |
| sub2api-video-mcp | 代码和 Provider 服务条款 | `LEGAL_REVIEW_REQUIRED` | 商业使用授权和 API 条款 |
| 本地 sub2api / Alchemy | 内部代码与账户数据处理 | `OWNER_APPROVAL_REQUIRED` | 权利人授权、数据处理和费用归属 |

上线前必须生成机器可读 SBOM、第三方 NOTICE、SPDX 归档、生产镜像 digest、依赖漏洞报告和密钥扫描报告；任何未核验来源不得打包为商用发布物。隐私政策、服务条款、DPA、数据驻留、删除/导出 SLA、版权投诉、滥用处理、分包商清单和支持 SLA 也必须由负责人/法律审核签字。
