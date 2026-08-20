import React from 'react';
import { Sparkles, ArrowRight } from 'lucide-react';

export default function DashboardTipCard({ totalRequests = 0 }: { totalRequests?: number }) {
  return (
    <div className="glass-card p-5 md:p-6 border-white/5 bg-gradient-to-br from-sky-500/10 via-white/[0.02] to-transparent hover:border-sky-500/20 transition-all rounded-2xl flex flex-col justify-between">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[10px] font-bold uppercase tracking-widest text-sky-400 flex items-center gap-1.5">
          <Sparkles size={12} /> Neural Grid Status
        </span>
        <span className="text-[9px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
          HEALTHY
        </span>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed mb-4">
        {totalRequests > 0
          ? `${totalRequests.toLocaleString()} requests routed through low-latency edge workers with 99.995% SLA.`
          : 'High-throughput intelligence router initialized. Ready to process concurrent inference streams.'}
      </p>
      <div className="text-[10px] font-bold text-foreground/80 flex items-center gap-1 uppercase tracking-wider group cursor-pointer">
        Optimize Routing <ArrowRight size={10} className="transition-transform group-hover:translate-x-1" />
      </div>
    </div>
  );
}
