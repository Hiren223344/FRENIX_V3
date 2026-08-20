import React from 'react';
import { JellyBlobMascot } from 'feral-blob';
import 'feral-blob/blob.css';

export default function FloatingAssistant() {
  return (
    <div className="fixed bottom-6 left-6 z-50 flex items-center gap-3 bg-black/90 backdrop-blur-2xl border border-white/10 px-3.5 py-2 rounded-full shadow-[0_8px_32px_rgba(0,0,0,0.8)] transition-all hover:border-white/20">
      <div className="w-8 h-8 flex items-center justify-center flex-shrink-0 overflow-hidden" style={{ width: '32px', height: '32px' }}>
        <JellyBlobMascot mood="happy" happyEyes="star" />
      </div>
      <div className="flex flex-col">
        <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest leading-none">Neural Co-Pilot</span>
        <span className="text-[11px] font-semibold text-white mt-0.5 leading-none">Cluster Operational</span>
      </div>
    </div>
  );
}
