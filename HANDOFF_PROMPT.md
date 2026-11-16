# 交接提示词：Orbital Frontier（轨道边疆）阶段六

> 把下面「提示词正文」整段复制给接手的 AI。

---

## 提示词正文

你是接手 **Orbital Frontier（轨道边疆）** 的技术负责人。这是一个浏览器端的实时 3D 火箭发射与轨道飞行模拟游戏，基于真实物理。前五个阶段已完成并推送，请从**阶段六：高级轨道任务**开始。所有界面、文档、提交信息、汇报一律使用**中文**。

### 一、仓库与分支规则
- 仓库：`qq410407746/simrocket`，工作目录 `/home/user/simrocket`。
- **只在分支 `feature/001` 上开发、提交、推送**（`git push -u origin feature/001`，网络失败最多重试 4 次）。**不要创建 Pull Request**，除非用户明确要求。
- 用户会自己往 `feature/001` 推送提交（已有：minimatch overrides、GitHub Pages 部署流程）。推送被拒时：`git fetch` → `git pull --rebase origin feature/001` →（锁文件变了就 `npm ci`）→ 再推。
- 提交信息不要写任何模型名称。不要把用户的姓名、邮箱等个人信息发到任何外部服务。
- 当前 HEAD：`0331884`（工作区干净，已与远端同步）。

### 二、不可违反的工程原则
1. 物理层独立、可测试，不依赖 React / Three / 任何引擎；渲染层绝不决定物理状态。
2. 分层由 ESLint `no-restricted-imports` 强制：`src/game/**` 不得引入 react、three、zustand、@react-three，也不得引入 rendering / components / app / stores。内容数据放 `src/data`。
3. 全部使用 SI 单位；常量集中管理；**不得编造物理数据**；NaN / Infinity 不得进入渲染。
4. **未实现的系统必须明确标注，不得描述为已完成；不得编造性能结果**（本环境没有 GPU，渲染帧率只有 1–5 FPS，如实报告）。
5. 避免 `any`；每个阶段结束项目都必须能运行。
6. 文档必须与真实代码一致：README、ARCHITECTURE、PHYSICS、ROADMAP、TASKS、TESTING、GAME_DESIGN。每次改动同步更新。
7. **每个阶段完成后给用户写一份中文报告，然后等用户确认，再开始下一阶段。**（报告格式参考上一份：完成了什么、验收、发现并修正的问题、没有完成或没有验证的、需要用户确认的事项、下一阶段计划。）

### 三、技术栈与运行环境
- TypeScript + React + Three.js（@react-three）+ Zustand；物理在 Web Worker 中运行（`SimulationHost` 包装 `Simulation`），`PHYSICS_DT = 0.02 s`，快照约 60 Hz，界面状态 10 Hz。
- 校验命令（每次提交前都跑）：类型检查、ESLint、单元测试、`npm run build`。当前基线：**569 项单元测试（31 个文件）全部通过，26 项 Playwright 端到端测试全部通过（约 13 分钟）**，生产构建通过。
- Playwright 已预装（1.63.0），**不要执行 `playwright install`**；跑 e2e 加 `--trace off`；**跑 e2e 时不要同时跑其他重 CPU 任务**。
- **不要运行 prettier**（项目没有配置）。
- 前台 `sleep` 被禁用，需要等待就用后台运行或 until 循环。
- 截图用 Playwright + SwiftShader 软件渲染；截图 `deviceScaleFactor: 2`。

### 四、已完成的内容（阶段一至五）
- 物理：二体轨道与开普勒元素、大气与气动阻力、多级火箭与分离、整流罩、质量特性、热力学（驻点热流、烧蚀防热大底、锥面侧壁受热）、再入、降落伞、着陆判定、姿态模式（含逆行 / 顺行等指向模式）。
- **配平再入**（commit `8cf99fe`）：牛顿流球冠模型，由返回舱质心偏移算出配平迎角（白鹭号 19.8°、升阻比 0.31），`Y` 键进入配平模式，`Q/E` 改倾侧角；流星-S 质心在轴线上不可配平。**抛防热大底**：`H` 键，减重 650 kg，作为分离体单独飞行。相关：`src/game/physics/aerodynamics/trim.ts`、`attitude/pointing.ts`、`Simulation.ts`。
- **发射方位角**：`src/game/physics/orbital/launch.ts`（`cos i = cos φ · sin β`，已扣除地球自转）。
- **任务系统**（阶段五，commits `ae0e9a8`、`bd8f35a`、`73f2244`、`0331884`）：
  - `src/game/missions/`：`types.ts`、`tracker.ts`（纯归约 `updateMission`，10 Hz 在主线程判定，轨道目标要求关机后连续 10 s 满足）、`scoring.ts`（线性评分，S≥90 / A≥80 / B≥65 / C，失败 F）、`career.ts`（进度存档，读回时校验）、`logbook.ts`（最近 50 次飞行记录）、`guidance.ts`、`testing/flyMission.ts`（用"只看仪表、只按键盘"的测试驾驶员飞完整任务）。
  - `src/data/missions.ts`：七个任务——`karman-line`、`suborbital-hop`、`first-orbit`、`crew-return`、`orbital-flight`、`inclined-orbit`、`polar-orbit`。
  - 界面：主菜单三页（任务 / 自由飞行 / 飞行记录）、任务简报、飞行中任务条、结果面板与曲线、教学提示（`hud/missionHints.ts`）。存档在 LocalStorage（`orbital-frontier/career`）。
  - 测试驾驶员实测得分：卡门线 100 S；亚轨道 92–98 S；首次入轨 89 A；返回（配平+抛底）100 S / 弹道 73 B；载人轨道飞行 90 S；倾角轨道 81–89 A；极地 88–90。
- 已知局限（阶段五报告里已向用户说明）：任务没有真人玩过，评分线可能偏松或偏紧；e2e 只走完了卡门线任务；教学模式与飞行记录只做了一部分（曲线不能回放，存 LocalStorage 而非 IndexedDB）；没有地面轨迹；配平再入不是制导（倾角固定）；火箭 Δv 余量偏大（入轨后剩约 3 km/s）；键盘没有滚转程序，斜向发射的按键是"斜"的。

### 五、阶段六任务：高级轨道任务（尚未开始）
1. **在轨滑行改用解析计算**，支持远高于 1000× 的时间倍率（开普勒传播；注意大气、推力、分离事件边界要退出解析模式）。
2. **机动节点**：在轨道上规划一次点火（Δv 的顺行 / 径向 / 法向分量），显示点火后的轨道；加一个"指向机动方向"的姿态模式。
3. **地面轨迹**，以及在轨道地图上显示目标轨道（极地任务现在只能看倾角读数，这里补上）。
4. **GTO 注入、远地点变轨与圆化、倾角修正**。
5. **GSO / GEO 判定**：GEO 还要求星下点经度基本不动（周期≈恒星日、偏心率与倾角足够小）。
6. **天顶三号的卫星部署任务**，接入现有任务系统（需要新增目标类型与评分指标；`ObjectiveSpec` 与 `MetricId` 在 `src/game/missions/types.ts`，判定在 `tracker.ts`）。
7. 可选：激波层辐射加热。
8. 同时回头处理：Δv 余量过大的问题（设计 GTO 载荷时决定是否收紧，评分基准要跟着调整）。

**验收**：玩家能在游戏里完成"发射 → 停泊轨道 → 规划并执行 GTO 注入 → 远地点圆化 → 部署卫星 → 判定 GEO"的完整任务，并有对应的单元测试（用测试驾驶员飞完）与至少一条 e2e。

### 六、开始前请先做
1. 读 `ROADMAP.md`、`TASKS.md`、`ARCHITECTURE.md`、`PHYSICS.md`、`TESTING.md`，再读 `src/game/missions/*` 与 `src/game/simulation/Simulation.ts`，弄清现有结构。
2. 跑一遍类型检查 / ESLint / 单元测试，确认基线是绿的，再动手。
3. 先写阶段六的实施计划（含物理推导与测试方案），小步提交，每步都保持可运行。

### 七、待用户确认的事项（阶段五报告中提出，用户尚未回复）
1. 用户实际游玩后对任务难度、评分、提示的反馈；
2. 斜向发射是否加"起飞后自动滚转对准发射方向"（用户此前说先不加自动滚转）；
3. 任务模式是否允许更换火箭与发射场；
4. Δv 余量是否收紧。
没有收到答复前，按"保持现状"处理，并在阶段六报告里再次询问。
