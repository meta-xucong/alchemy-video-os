# AI 企业内容生产平台：完整开发方案

> 文档定位说明：本文保留产品愿景、长期能力地图和完整业务需求。正式开发的章节顺序、目录命名、状态机、契约、测试和审计门禁，以同目录《AI企业内容生产平台_正式开发总控文档.md》为准；本文不再作为单独的编码顺序依据。

## 1. 项目定位

目标：以 **OpenMontage** 为 AI 视频生产与 Agent 编排底座，吸收 **Huobao Drama** 的项目/素材/工作台思想，引入 **Microsoft MarkItDown** 作为企业资料解析入口，并将 **Seedance 2.5 Skill** 纳入视频模型技能层，构建面向企业宣传片、广告、产品视频、招聘视频、展会视频及泛 AI 短视频的企业级 AI 内容生产平台。

核心定位：

> **企业 AI 内容生产部门 / AI Video Production OS**

核心价值链：

```text
企业资料 → 企业知识理解 → 企业资产管理 → AI策划 → AI导演
→ AI分镜 → 模型路由 → 视频/图片/音频生成 → 剪辑合成 → QC → 成片
```

第一阶段不要做“万能视频平台”，先聚焦：

> **AI 企业宣传片生成器**

---

## 2. 总体架构

```text
                         用户
                          │
                          ▼
                    Web Application
                          │
             ┌────────────┴────────────┐
             │                         │
          用户系统                  企业工作空间
             │                         │
             └────────────┬────────────┘
                          ▼
                     项目管理系统
                          │
             ┌────────────┼────────────┐
             │            │            │
          企业资料       素材库       项目资产
             │            │            │
             ▼            ▼            ▼
        MarkItDown       DAM      Asset Registry
             │            │            │
             └────────────┼────────────┘
                          ▼
                  企业知识库 / RAG
                          │
                          ▼
                   AI Director Agent
                     （OpenMontage）
                          │
            ┌─────────────┼─────────────┐
            │             │             │
          策划层        内容层        制作层
            │             │             │
       Strategy Agent  Script Agent  Production
                          │
                          ▼
                   Storyboard Agent
                          │
                          ▼
                   Model Skill Router
                          │
          ┌───────────────┼────────────────┐
          │               │                │
    Seedance Skill    Kling Skill      Other Skills
          │               │                │
          ▼               ▼                ▼
      视频模型API      视频模型API      视频模型API
          │               │                │
          └───────────────┼────────────────┘
                          ▼
                    Video Assembly
                   FFmpeg / Remotion
                          │
                          ▼
                     Quality Control
                          │
                          ▼
                         成片
```

---

## 3. 四个开源项目的职责

### 3.1 OpenMontage：AI 视频生产大脑

定位：

> **AI Director + Agent Orchestration + Video Production Tools**

负责：

- 任务理解
- 工作流规划
- Agent 调度
- 视频生产工具调用
- 图片/视频/音频生成
- 后期处理
- FFmpeg / Remotion
- 质量检查
- Pipeline 执行

不要把 OpenMontage 简单当作“视频生成器”，而应作为系统的**生产执行引擎**。

### 3.2 Huobao Drama：产品化工作台参考

重点吸收：

- 用户系统
- 项目系统
- 项目资产
- 素材库
- 分镜管理
- 任务状态
- Web 工作台
- 视频生产 UI
- 任务进度
- Docker 化部署思路

原则：

> OpenMontage 负责“怎么做”，Huobao 的产品化思想负责“用户怎么管理和操作”。

### 3.3 MarkItDown：企业资料入口

正确流程：

```text
用户上传文件
↓
文件存储
↓
MarkItDown
↓
标准化 Markdown
↓
信息抽取
↓
企业结构化画像
↓
分块
↓
Embedding
↓
向量数据库
↓
企业知识库
```

MarkItDown 本身不是知识库，而是企业资料的 ingestion 层。

### 3.4 Seedance 2.5：视频模型专项 Skill

定位：

> **Video Model Skill**

负责：

- Seedance 2.5 模式选择
- T2V / I2V / Reference
- Ultra-long
- Native Extension
- Edit
- 多模态参考
- Reference Role Map
- Timestamp Prompt
- Seedance Prompt 优化
- 常见失败修复
- 模型参数推荐

核心原则：

```text
Image1 → 产品身份
Image2 → 工厂环境
Video1 → 摄像机运动
Audio1 → 节奏
Logo → 品牌身份
```

---

# 4. 企业大脑

真正的核心竞争力不是视频模型，而是：

> **企业知识 + 企业资产 + AI 导演**

企业资料进入系统后形成三层数据。

## 4.1 企业知识

```json
{
  "company_name": "XX科技",
  "industry": "新能源",
  "company_history": [],
  "products": [],
  "advantages": [],
  "customers": [],
  "certifications": [],
  "technology": [],
  "brand_tone": [],
  "forbidden_claims": []
}
```

## 4.2 企业资产

```text
Logo
产品照片
产品视频
工厂照片
工厂视频
CEO照片
员工照片
客户案例
历史宣传片
品牌音乐
品牌字体
品牌色
```

## 4.3 企业规则

例如：

```text
品牌主色：蓝色
品牌风格：科技、高端、可靠
目标客户：工业企业
禁止：
- 夸大宣传
- 未经资料支持的数字
- 未经批准的客户名称
- 修改产品外观
```

三者共同构成：

> Enterprise Context

---

# 5. 企业素材库 / DAM

建议设计成 Digital Asset Management。

## Asset 表

```text
asset_id
workspace_id
project_id
file_url
thumbnail_url
asset_type
mime_type
size
duration
width
height
metadata
created_at
updated_at
```

## Asset 类型

```text
image
video
audio
document
logo
font
product
person
location
brand
other
```

## AI 标签

```text
人物：
  CEO
  employee

产品：
  battery
  inverter

场景：
  factory
  office
  showroom

用途：
  product_showcase
  opening
  ending
  recruitment
```

---

# 6. Reference Ownership：核心机制

每个素材必须有明确职责，而不是把所有素材无差别塞给模型。

例如：

```text
产品图片 → Product Identity
工厂照片 → Environment Reference
CEO照片 → Person Identity
旧宣传片 → Camera / Motion Reference
品牌音乐 → Audio Reference
Logo     → Brand Identity
```

系统应生成：

```json
{
  "references": [
    {
      "asset_id": "xxx",
      "role": "product_identity"
    },
    {
      "asset_id": "yyy",
      "role": "environment_reference"
    }
  ]
}
```

这对于企业产品一致性尤其重要。

---

# 7. 企业宣传片自动生产流程

## Step 1：创建企业

用户创建企业空间。

## Step 2：上传资料

允许：

```text
企业简介.pdf
产品说明.pptx
产品参数.xlsx
公司介绍.docx
历史宣传片.mp4
Logo.png
工厂照片.zip
```

## Step 3：资料解析

```text
文件 → MarkItDown → Markdown → Information Extraction Agent
```

## Step 4：生成企业画像

自动提取：

```text
企业名称
行业
主营业务
产品
技术
优势
客户
品牌调性
核心卖点
禁止表述
```

用户可以人工修改。

## Step 5：素材分析

AI 对图片/视频进行：

- 产品
- 人物
- 工厂
- 办公场所
- 设备
- 场景
- 历史视频

等标签。

## Step 6：用户提出需求

例如：

> 做一个 60 秒科技感企业宣传片，用于上海工业展。

## Step 7：Strategy Agent

分析：

```text
目标：展会宣传
受众：工业客户
时长：60秒
风格：科技、高端
重点：产品 + 工厂 + 技术能力
```

## Step 8：Script Agent

例如：

```text
0-5s    品牌开场
5-15s   企业实力
15-30s  核心产品
30-45s  技术能力
45-55s  客户价值
55-60s  Logo + CTA
```

## Step 9：Storyboard Agent

每个 Shot 至少包含：

```json
{
  "duration": 6,
  "scene": "",
  "action": "",
  "camera": "",
  "visual_style": "",
  "voiceover": "",
  "references": [],
  "generation_strategy": ""
}
```

---

# 8. Model Skill Router

不要所有镜头都强制使用同一个模型：

```text
Shot
↓
能力分析
↓
Model Router
↓
选择最合适 Provider
```

例如：

```text
产品一致性要求高 → Seedance
人物说话 → 适合数字人/口型模型
高速运动 → 运动能力更强的模型
局部修改 → Seedance Edit
已有视频延长 → Seedance Extension
普通 B-roll → 成本更低的视频模型
```

---

# 9. Provider 抽象层

Agent 不应该直接调用具体 API。

统一接口：

```python
class VideoProvider:
    async def generate(self, request):
        ...

    async def extend(self, request):
        ...

    async def edit(self, request):
        ...

    async def get_status(self, task_id):
        ...

    async def download(self, task_id):
        ...
```

Provider：

```text
SeedanceProvider
KlingProvider
VeoProvider
ViduProvider
RunwayProvider
```

LLM 同样抽象：

```text
OpenAI
Claude
Gemini
Qwen
DeepSeek
其他 OpenAI-compatible API
```

---

# 10. Model Skill Registry

每个模型建立自己的 Skill：

```text
skills/
├── seedance/
├── kling/
├── veo/
├── vidu/
└── image/
```

每个 Skill 可以包含：

```text
capabilities.md
prompting.md
references.md
editing.md
troubleshooting.md
pricing.md
limitations.md
```

以后 Agent 可以根据 Provider 自动读取对应模型技能。

---

# 11. Agent 层

第一版建议至少包含：

### Director Agent
总规划、调度。

### Enterprise Analyst Agent
理解企业资料。

### Strategy Agent
决定视频类型、受众、传播目的、风格、时长。

### Script Agent
生成文案、旁白、内容结构。

### Storyboard Agent
生成镜头、时间、场景、动作、摄影机、参考素材。

### Asset Agent
负责素材检索和 Reference Role。

### Model Router Agent
选择视频模型、图片模型、TTS、音乐。

### Video Production Agent
负责视频生成、重试、Extension、Edit。

### Edit Agent
负责剪辑、字幕、音频、转场、BGM、Logo。

### QC Agent
检查：

```text
产品是否变形
人物是否一致
旁白是否正确
企业事实是否正确
Logo是否正确
字幕是否错误
镜头是否连续
视频是否完整
```

---

# 12. 任务系统

视频生成属于长任务，不应让 HTTP 请求阻塞。

建议：

```text
FastAPI
+
Redis
+
Celery / Arq
```

状态：

```text
PROJECT_CREATED
ASSET_PROCESSING
KNOWLEDGE_BUILDING
SCRIPT_GENERATING
STORYBOARD_GENERATING
VIDEO_GENERATING
VIDEO_EDITING
QC_RUNNING
COMPLETED
FAILED
```

---

# 13. 数据库

第一版推荐：

> PostgreSQL + pgvector

核心表：

```text
users
workspaces
workspace_members
projects
assets
asset_tags
documents
document_chunks
knowledge_items
scripts
storyboards
shots
generation_tasks
generation_results
providers
model_skills
prompts
videos
video_versions
qc_results
```

---

# 14. 文件存储

推荐：

> S3 / MinIO

目录：

```text
/workspaces/{workspace_id}/
    documents/
    assets/
    projects/
        {project_id}/
            storyboard/
            generated/
            final/
```

大视频不要存 PostgreSQL。

---

# 15. Web 前端

推荐：

> Next.js + TypeScript

主要页面：

```text
/login
/workspaces
/workspace/{id}
/workspace/{id}/knowledge
/workspace/{id}/assets
/workspace/{id}/projects
/project/{id}
/project/{id}/script
/project/{id}/storyboard
/project/{id}/generation
/project/{id}/editor
/project/{id}/versions
```

---

# 16. 项目工作台

核心界面：

```text
┌─────────────────────────────────────────────┐
│ 项目名称                       [生成视频]    │
├──────────────┬──────────────────────────────┤
│ 项目导航     │                              │
│              │          Storyboard          │
│ 概览         │                              │
│ 企业资料     │  Shot 01                    │
│ 素材库       │  Shot 02                    │
│ 脚本         │  Shot 03                    │
│ 分镜         │  Shot 04                    │
│ 生成任务     │                              │
│ 成片         │                              │
└──────────────┴──────────────────────────────┘
```

---

# 17. 人机协作

不要完全黑盒自动化。

推荐：

```text
AI生成
↓
用户预览
↓
用户修改
↓
AI继续
```

关键审批节点：

1. 企业画像确认
2. 脚本确认
3. 分镜确认
4. 成片确认

---

# 18. 质量控制

建立三级 QC。

## Level 1：结构 QC

- 视频是否生成
- 时长是否正确
- 分辨率
- 音频
- 文件完整性

## Level 2：内容 QC

- 企业事实
- 产品信息
- 字幕
- 旁白
- Logo

## Level 3：视觉 QC

- 产品一致性
- 人物一致性
- 镜头连续性
- 画面异常
- AI 伪影

失败后不应简单重试，而应：

```text
Diagnose
↓
Edit / Regenerate
```

---

# 19. 成本控制

记录每次模型调用：

```text
provider
model
input
output
duration
estimated_cost
actual_cost
task_id
```

计算：

```text
项目成本
用户成本
毛利
```

以后可按：

- 项目
- 视频分钟
- 生成次数
- 套餐

收费。

---

# 20. MVP

第一版必须有：

### 用户
- 注册
- 登录
- 企业空间

### 企业
- 创建企业
- 上传文件
- MarkItDown
- 企业画像

### 素材
- 图片
- 视频
- Logo
- AI 标签

### 项目
- 创建项目
- 输入需求

### AI
- 企业分析
- Script Agent
- Storyboard Agent
- Director Agent

### 视频
先支持一个 Provider：

> **Seedance 2.5**

### 后期
- FFmpeg
- 字幕
- BGM
- Logo

### 输出
- MP4
- 历史版本

第一版暂时不要做：

- 多租户复杂权限
- 10个视频模型
- 移动端
- 实时协作
- 复杂时间线编辑器
- 自建 GPU 模型
- 复杂 RAG
- 自动发布到所有平台

---

# 21. 开发阶段

## Phase 0：许可证与技术尽调

优先确认：

- OpenMontage AGPL
- Huobao License
- MarkItDown License
- Seedance Skill MIT
- Seedance / Jimeng / API 商业条款
- 所有第三方模型 Provider 条款

重点确认：

> 最终产品是否允许闭源 SaaS、是否需要公开修改后的源码、是否允许商业 API 调用。

---

## Phase 1：跑通 OpenMontage

目标：

```text
本地运行
↓
VPS运行
↓
调用一个LLM
↓
调用一个视频Provider
↓
生成视频
```

---

## Phase 2：Web API

```text
Next.js
↓
FastAPI
↓
OpenMontage
```

先实现：

```text
POST /projects
POST /generate
GET /tasks/{id}
GET /videos/{id}
```

---

## Phase 3：企业资料系统

```text
上传
↓
MarkItDown
↓
Markdown
↓
知识抽取
↓
PostgreSQL
↓
pgvector
```

---

## Phase 4：企业素材库

实现：

```text
Asset
Tag
Search
Preview
Reference Role
```

---

## Phase 5：Director Agent

```text
需求
↓
企业知识
↓
项目历史
↓
Strategy
↓
Script
↓
Storyboard
```

---

## Phase 6：Seedance Skill

将 Seedance-2.5 Skill 重新组织成平台内部 Skill：

```text
Model Skill Registry
↓
Seedance Skill
↓
Prompt + Reference Role + Mode
```

---

## Phase 7：视频生产

```text
Storyboard
↓
Model Router
↓
Seedance
↓
结果
↓
QC
↓
重试 / Edit
```

---

## Phase 8：后期

```text
视频片段
+
旁白
+
BGM
+
字幕
+
Logo
↓
FFmpeg / Remotion
↓
Final MP4
```

---

## Phase 9：第二个 Provider

增加 Kling / Vidu / Veo 中的一个，然后验证：

```text
同一 Shot
↓
不同模型
↓
自动选择
```

---

# 22. VPS 部署

如果全部模型都走 API：

推荐 MVP：

```text
4 vCPU
8 GB RAM
100 GB SSD
Ubuntu 24.04
```

组件：

```text
Nginx
Docker
PostgreSQL
Redis
MinIO
FastAPI
Worker
Next.js
FFmpeg
```

如果只做 API 视频生成：

> 不需要 GPU。

GPU 只在以后部署本地视频模型时增加。

---

# 23. Docker 架构

```text
docker-compose
│
├── frontend
├── api
├── worker
├── postgres
├── redis
├── minio
└── nginx
```

生产环境：

```text
Internet
↓
Nginx
↓
Frontend
↓
FastAPI
↓
Redis
↓
Worker
↓
OpenMontage
↓
External APIs
```

---

# 24. 安全设计

企业资料可能包含商业机密。

## 文件安全

- 文件类型白名单
- 文件大小限制
- 病毒扫描
- 隔离上传目录
- 不允许任意执行上传文件

## API Key

用户 Key：

- 不进入前端
- 加密存储
- 最小权限
- 日志脱敏

平台 Key：

- 环境变量 / Secret Manager
- 不进入数据库明文

## 企业隔离

所有数据必须通过：

```text
workspace_id
```

隔离，禁止跨企业检索。

---

# 25. 一次完整生成的数据流

```text
用户
↓
创建项目
↓
输入“生成60秒企业宣传片”
↓
读取企业知识库
↓
读取素材库
↓
Director Agent
↓
Strategy
↓
Script
↓
Storyboard
↓
Asset Agent
↓
Reference Role Map
↓
Model Router
↓
Seedance Skill
↓
Seedance API
↓
生成多个 Shot
↓
QC
├─ 通过 → Edit / Assemble
└─ 失败 → Diagnose → Edit / Regenerate
↓
FFmpeg / Remotion
↓
最终视频
↓
用户审批
↓
Version 保存
```

---

# 26. 从企业宣传片扩展到泛 AI 视频

底层架构不变，只增加内容策略：

```text
Enterprise
├── Corporate Film
├── Product Video
├── Recruitment Video
├── Exhibition Video
├── Brand Video
└── Investor Video

Marketing
├── Advertisement
├── Social Short
├── Product Launch
└── E-commerce Video

Content
├── Knowledge Short
├── News Video
├── Tutorial
├── Documentary
└── Storytelling

Entertainment
├── Short Drama
├── Music Video
├── Animation
└── Narrative Short
```

因此：

> **企业宣传片是最适合作为 MVP 的垂直场景，而不是最终边界。**

---

# 27. 推荐技术栈

| 层 | 技术 |
|---|---|
| Frontend | Next.js + TypeScript |
| Backend | FastAPI + Python |
| Agent | OpenMontage / Agent Skills |
| LLM | OpenAI / Claude / Gemini / Qwen |
| Document | MarkItDown |
| Database | PostgreSQL |
| Vector | pgvector |
| Queue | Redis + Celery/Arq |
| Object Storage | S3 / MinIO |
| Video | Seedance / Kling / Vidu / Veo |
| Image | Flux / Seedream / Imagen 等 |
| TTS | MiniMax / ElevenLabs / OpenAI 等 |
| Editing | FFmpeg |
| Composition | Remotion |
| Deployment | Docker Compose |
| Reverse Proxy | Nginx |

---

# 28. 七层系统模型

最终严格分成七层：

```text
Layer 1
用户与企业
↓
Layer 2
项目 / 素材 / 权限
↓
Layer 3
企业知识
↓
Layer 4
AI Director / Agents
↓
Layer 5
Model Skill Registry
↓
Layer 6
模型 Provider
↓
Layer 7
Video Production / Rendering
```

映射关系：

```text
MarkItDown
→ Layer 3 输入端

Huobao 思想
→ Layer 1/2

OpenMontage
→ Layer 4 + Layer 7 核心能力

Seedance-2.5
→ Layer 5 的一个 Model Skill
```

---

# 29. 最终产品形态

用户不应该知道 OpenMontage、MarkItDown、Seedance、FFmpeg、RAG、Agent、Provider 等底层技术。

用户只看到：

```text
┌──────────────────────────────────┐
│        创建一个新视频             │
│                                  │
│  上传企业资料                     │
│  上传企业素材                     │
│                                  │
│  视频类型：企业宣传片             │
│  时长：60秒                       │
│  风格：科技、高端                 │
│  用途：上海工业展                 │
│                                  │
│           [开始生成]              │
└──────────────────────────────────┘
```

后台自动：

```text
理解企业
→
理解需求
→
策划
→
写脚本
→
做分镜
→
选择素材
→
选择模型
→
生成
→
审核
→
修复
→
剪辑
→
输出
```

最终产品定义：

> **一个能够读取企业全部资料、理解企业品牌、自动策划并生产各种商业视频的 AI 内容生产平台。**

---

# 30. MVP 成功标准

给系统一个真实企业：

```text
10~30份企业资料
20~100个图片/视频素材
```

用户只输入：

> “帮我做一个60秒科技感企业宣传片，用于展会。”

系统在无需开发者介入的情况下：

1. 正确理解企业
2. 正确提取产品和卖点
3. 不编造企业信息
4. 自动选择真实企业素材
5. 生成完整脚本
6. 生成可执行分镜
7. 自动调用视频模型
8. 生成多个镜头
9. 自动发现明显错误
10. 自动修复/重生成
11. 自动配音
12. 自动字幕
13. 自动合成
14. 输出可播放 MP4
15. 保存整个项目和版本

达到这个闭环：

> **MVP 即成功。**

---

# 31. 工程原则

**不要把四个开源项目直接揉成一个巨型代码库。**

正确做法：

```text
OpenMontage
↓
Adapter / Integration Layer

MarkItDown
↓
Document Ingestion Adapter

Seedance Skill
↓
Model Skill Adapter

Huobao
↓
只吸收产品/工程设计，不强行复制全部代码
```

通过自己的领域模型和接口连接。

这样即使未来：

- OpenMontage 更换
- Seedance API 改变
- Huobao 停止维护
- MarkItDown 增加/删除格式

平台核心仍不会被绑死。

---

# 32. 建议仓库结构

```text
ai-video-platform/
│
├── apps/
│   ├── web/
│   └── api/
│
├── agents/
│   ├── director/
│   ├── enterprise/
│   ├── strategy/
│   ├── script/
│   ├── storyboard/
│   ├── asset/
│   ├── router/
│   ├── production/
│   ├── edit/
│   └── qc/
│
├── skills/
│   ├── video/
│   │   ├── seedance/
│   │   ├── kling/
│   │   └── veo/
│   ├── image/
│   ├── audio/
│   └── editing/
│
├── providers/
│   ├── llm/
│   ├── video/
│   ├── image/
│   └── tts/
│
├── knowledge/
│   ├── ingestion/
│   ├── extraction/
│   ├── embeddings/
│   └── retrieval/
│
├── assets/
│   ├── storage/
│   ├── analysis/
│   └── tagging/
│
├── production/
│   ├── ffmpeg/
│   ├── remotion/
│   └── render/
│
├── database/
├── workers/
├── tests/
├── docs/
├── docker-compose.yml
└── README.md
```

---

# 33. 开发优先级

```text
P0 许可证 / API 商业条款
↓
P0 运行 OpenMontage
↓
P0 Seedance Provider
↓
P0 企业资料 → MarkItDown → 知识库
↓
P0 Director → Script → Storyboard
↓
P0 Storyboard → Video
↓
P0 FFmpeg → Final Video
↓
P1 素材库 / Asset Role
↓
P1 QC / Repair
↓
P1 项目版本
↓
P1 第二视频 Provider
↓
P2 计费
↓
P2 多人协作
↓
P2 更多视频类型
↓
P3 自动发布 / 企业工作流集成
```

---

# 34. 最终架构结论

合理的组合不是简单把几个 GitHub 项目“拼起来”，而是：

```text
MarkItDown
= 企业资料理解入口

企业知识库 + DAM
= 企业记忆

OpenMontage
= AI Director / Agent Production OS

Seedance-2.5 Skill
= Seedance 专项模型技能

Model Skill Registry
= 多模型能力层

Huobao 的设计思想
= 产品化工作台

FFmpeg / Remotion
= 最终生产与渲染

Next.js + FastAPI
= SaaS 产品层
```

最终：

```text
             企业资料
                 ↓
          企业 AI 大脑
                 ↓
          AI Director
                 ↓
       ┌─────────┴─────────┐
       │                   │
     内容策划             模型策略
       │                   │
       └─────────┬─────────┘
                 ↓
          视频生产 Agent
                 ↓
       Model Skill Registry
                 ↓
      多模型自动选择/调用
                 ↓
          QC + Repair
                 ↓
        FFmpeg / Remotion
                 ↓
              成片
```

**第一阶段只做“企业资料 → 自动生成 60 秒企业宣传片”这一条链路。**

如果这一条链路跑通，广告、产品视频、招聘视频、展会视频、短视频、知识视频、短剧等，本质上都是在同一套底层架构上增加新的内容策略和生产模板。
