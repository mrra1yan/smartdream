"use client";

import { motion } from "framer-motion";
import { Zap } from "lucide-react";

interface AuthHeroProps {
  title: string;
  subtitle: string;
}

export function AuthHero({ title, subtitle }: AuthHeroProps) {
  return (
    <motion.div 
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
      className="flex items-center gap-4 mb-2"
    >
      <div className="relative flex-shrink-0">
        {/* Pulsing breathing background glow */}
        <motion.div 
          animate={{ scale: [1, 1.15, 1], opacity: [0.3, 0.5, 0.3] }}
          transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
          className="absolute inset-0 rounded-2xl bg-accent blur-xl"
        />
        
        {/* Double layered border glow */}
        <div className="absolute -inset-[2px] rounded-2xl bg-gradient-to-tr from-accent via-indigo-500 to-purple-600 opacity-80" />
        
        <div className="relative flex h-12 w-12 items-center justify-center rounded-[14px] bg-zinc-950 dark:bg-zinc-950 shadow-inner">
          <Zap className="h-5.5 w-5.5 text-accent animate-pulse" strokeWidth={2.5} />
        </div>
      </div>
      <div>
        <h1 className="text-2xl font-black leading-none bg-gradient-to-r from-foreground via-foreground/95 to-muted-foreground/70 bg-clip-text text-transparent">
          {title}
        </h1>
        <p className="text-xs text-muted-foreground/80 mt-1.5 font-medium">
          {subtitle}
        </p>
      </div>
    </motion.div>
  );
}
