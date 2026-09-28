# 后端数据库补充说明

完整数据库文档位于 `docs/content/docs/backend/backend-database.mdx`。

## 低成本视频验收表

- `video_validation_runs`：验收模式、revision、NUMERIC 硬预算、活动预留与累计结算、成本上界违约标志和发生时间、并发与对账状态。
- `video_validation_items`：binding/case、版本化合同指纹、不可变执行快照与 payload digest、独立尝试和幂等键、可证明的成本上界、终态实际成本可用性及证据、预估及实际 provider 原币成本、HOTX 积分、逐项预留/结算金额、来源证据、预留状态和 worker 租约。数据库触发器禁止修改已存执行身份；未知提交保留预留并进入对账；取消仅在证明未创建/未收费后释放。
- `model_validation_verifications`：按 binding/case 保留每次终态的不可修改指纹历史；最近一次结果决定 `变更模型验证` 的复用或 drift。

Worker 先在 PostgreSQL 中原子预留预算，再允许提交真实 canary。创建批次和审计日志使用同一事务。两个表不保存 API Key、Authorization、签名媒体 URL或原始上游响应；验收也不进入用户钱包、hold、settlement、refund 和 usage snapshot。
