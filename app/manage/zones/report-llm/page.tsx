import { requirePermission } from '@/lib/admin';
import { ZonesSubNav } from '../_components/ZonesSubNav';
import { ReportLlmCard } from './ReportLlmCard';

export const dynamic = 'force-dynamic';

// /manage/zones/report-llm — 版块「生成报告」用的模型（docs/contracts/reports.md §6）。
// 默认沿用知识库 AI 的配置；要给报告单独配一个（更大的模型 / 不同网关）就在这里填。
// 写操作走 PUT /api/admin/zones/report-llm（gateApi('zones') + logAdmin）。

export default async function ManageZoneReportLlmPage() {
  await requirePermission('zones');
  return (
    <div className="space-y-4">
      <ZonesSubNav />
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">报告模型</h2>
        <p className="mt-1 text-xs text-muted">
          版块「生成报告」（聊天记录 → 日报 / 周报 / 月报）调用的大模型。流水线每一步都要求模型输出 JSON，
          所以自建 vLLM / SGLang 建议勾上「强制 JSON 输出」并关闭思考。保存后约 1 分钟内生效。
        </p>
      </div>
      <ReportLlmCard />
    </div>
  );
}
