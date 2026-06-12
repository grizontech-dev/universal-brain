"use client";

import React, { useEffect, useRef, useState } from "react";
import mermaid from "mermaid";

// Initialize mermaid
// Initialize mermaid with premium design system variables
mermaid.initialize({
    startOnLoad: false,
    theme: "base",
    securityLevel: "loose",
    themeVariables: {
        primaryColor: "#976df8",
        primaryTextColor: "#ffffff",
        primaryBorderColor: "#976df8",
        lineColor: "#ffffff40",
        secondaryColor: "#1e1e24",
        tertiaryColor: "#0f0f12",
        mainBkg: "rgba(151, 109, 248, 0.05)",
        nodeBorder: "rgba(151, 109, 248, 0.3)",
        clusterBkg: "rgba(255, 255, 255, 0.02)",
        clusterBorder: "rgba(255, 255, 255, 0.1)",
        defaultLinkColor: "rgba(255, 255, 255, 0.2)",
        titleColor: "#ffffff",
        edgeLabelBackground: "#0a0a0d",
        nodeTextColor: "#ffffff",
        fontFamily: "var(--font-inter), sans-serif",
        fontSize: "13px",
    },
    flowchart: {
        htmlLabels: true,
        curve: "basis",
        useMaxWidth: true,
    },
});

import { Copy, Check } from "lucide-react";

interface MermaidRendererProps {
    chart: string;
}

const MermaidRenderer: React.FC<MermaidRendererProps> = ({ chart }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [svg, setSvg] = useState<string>("");
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const renderChart = async () => {
            if (!containerRef.current || !chart) return;

            try {
                // Generate a unique ID for the mermaid diagram
                const id = `mermaid-${Math.random().toString(36).substr(2, 9)}`;
                
                // Clear state
                setError(null);
                
                // Clean the chart: Remove any leading "mermaid" keyword and trim
                let cleanedChart = chart.trim();
                if (cleanedChart.startsWith("mermaid")) {
                    cleanedChart = cleanedChart.replace(/^mermaid\s*/, "").trim();
                }

                // Process line by line to avoid giant regex overlaps
                const processedLines = cleanedChart.split('\n').map(line => {
                    let current = line;
                    
                    // 1. Handle node labels with various brackets (robustly handles nested brackets)
                    // Matches: ID[label], ID(label), ID((label)), ID{label}, ID>label]
                    
                    // Square brackets [] - Match from first [ to closing ] for that node
                    current = current.replace(/([\w-]+)\[([^\]]+)\]/g, (m, id, label) => {
                        if (label.startsWith('"') && label.endsWith('"')) return m;
                        // Avoid matching if it looks like an array or something else not related to a node
                        return `${id}["${label.replace(/"/g, "'")}"]`;
                    });
                    
                    // Double parentheses (())
                    current = current.replace(/([\w-]+)\(\((.+?)\)\)/g, (m, id, label) => {
                        if (label.startsWith('"') && label.endsWith('"')) return m;
                        return `${id}(("${label.replace(/"/g, "'")}"))`;
                    });

                    // Single parentheses () - avoid matching edge arrows like -->
                    current = current.replace(/([\w-]+)\((?!=\-)((?!\-\>)[^)]+)\)/g, (m, id, label) => {
                        if (label.startsWith('"') && label.endsWith('"')) return m;
                        if (/^(graph|flowchart|subgraph|sequenceDiagram|erDiagram|classDiagram|gannt|pie|gitGraph)$/.test(id)) return m;
                        return `${id}("${label.replace(/"/g, "'")}")`;
                    });

                    // Rhombus {}
                    current = current.replace(/([\w-]+)\{([^}]+)\}/g, (m, id, label) => {
                        if (label.startsWith('"') && label.endsWith('"')) return m;
                        return `${id}{"${label.replace(/"/g, "'")}"}`;
                    });

                    // 2. Handle edge labels: -->|label|
                    current = current.replace(/(-->|--|==>|~~|>)( ?)\|([^|]+)\|/g, (m, arrow, space, label) => {
                        if (label.trim().startsWith('"')) return m;
                        return `${arrow} |"${label.trim().replace(/"/g, "'")}"|`;
                    });

                    // 3. Fix invalid class assignments with spaces in node IDs
                    if (/^\s*class\s+(?!def\b)/i.test(current)) {
                        current = current.replace(/^(\s*class\s+)(.+?)(\s+[\w-]+\s*;?\s*)$/i, (m, prefix, ids, suffix) => {
                            const cleanedIds = ids.split(',').map((id: string) => id.replace(/\s+/g, '')).join(',');
                            return `${prefix}${cleanedIds}${suffix}`;
                        });
                    }

                    return current;
                });

                const processedChart = processedLines.join('\n');
                
                // Render
                const { svg } = await mermaid.render(id, processedChart);
                setSvg(svg);
            } catch (err) {
                console.error("Mermaid rendering error:", err);
                setError("Could not render diagram. Please check the syntax.");
            }
        };

        renderChart();
    }, [chart]);

    if (error) {
        return (
            <div className="p-4 rounded-xl border border-red-500/20 bg-red-500/5 text-red-400 text-xs font-mono">
                <div className="flex items-center justify-between mb-2">
                    <span>Rendering Error</span>
                </div>
                {error}
                <pre className="mt-2 text-[10px] text-red-400/50 overflow-x-auto">
                    {chart}
                </pre>
            </div>
        );
    }

    return (
        <div className="relative group my-8 w-full animate-in fade-in zoom-in duration-500">
            <div 
                ref={containerRef} 
                className="mermaid-container flex justify-center py-10 px-6 overflow-x-auto bg-[#0a0a0d]/50 backdrop-blur-md border border-white/[0.08] rounded-3xl shadow-2xl transition-all hover:border-[#976df8]/30 group/mermaid
                [&_svg]:max-w-full [&_svg]:h-auto
                [&_.node_rect]:!fill-[#16161a]/60 [&_.node_rect]:!stroke-[#976df8]/30 [&_.node_rect]:!rx-3 [&_.node_rect]:!ry-3
                [&_.cluster_rect]:!fill-[#ffffff]/[0.02] [&_.cluster_rect]:!stroke-[#ffffff]/10 [&_.cluster_rect]:!rx-4 [&_.cluster_rect]:!ry-4
                [&_.edgePath_path]:!stroke-[#ffffff]/20 [&_.edgePath_path]:!stroke-[1.5]
                [&_.marker]:!fill-[#ffffff]/20
                [&_.node_label]:!text-[#ffffff]/90 [&_.node_label]:!font-bold [&_.node_label]:!tracking-tight
                [&_.cluster_label]:!text-[#ffffff]/30 [&_.cluster_label]:!font-black [&_.cluster_label]:!uppercase [&_.cluster_label]:!tracking-[0.2em] [&_.cluster_label]:!text-[10px]"
                dangerouslySetInnerHTML={{ __html: svg }}
            />
        </div>
    );
};

export default MermaidRenderer;

