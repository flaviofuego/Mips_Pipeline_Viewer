// src/components/pipeline-visualization.tsx
"use client";

import type * as React from 'react';
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
  TableCaption,
} from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { 
  Download, 
  Code2, 
  Cpu, 
  MemoryStick, 
  CheckSquare, 
  AlertTriangle, 
  ArrowRight,
  Zap,
  Clock
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSimulationState } from '@/context/SimulationContext';

const STAGES = [
  { name: 'IF', icon: Download, description: 'Instruction Fetch' },
  { name: 'ID', icon: Code2, description: 'Instruction Decode' },
  { name: 'EX', icon: Cpu, description: 'Execute' },
  { name: 'MEM', icon: MemoryStick, description: 'Memory Access' },
  { name: 'WB', icon: CheckSquare, description: 'Write Back' },
] as const;

// Componente para mostrar paths de forwarding como flechas
const ForwardingArrow: React.FC<{
  fromStage: number;
  toStage: number;
  register: number;
  className?: string;
}> = ({ fromStage, toStage, register, className }) => {
  return (
    <div className={cn("absolute inset-0 pointer-events-none z-20", className)}>
      <div className="relative w-full h-full">
        {/* Flecha visual simplificada */}
        <div className="absolute top-1/2 left-1/4 right-1/4 h-0.5 bg-blue-500 transform -translate-y-1/2">
          <div className="absolute right-0 top-1/2 w-0 h-0 border-l-2 border-l-blue-500 border-t border-b border-transparent transform -translate-y-1/2" />
        </div>
        {/* Etiqueta del registro */}
        <div className="absolute top-0 left-1/2 transform -translate-x-1/2 bg-blue-500 text-white text-xs px-1 rounded">
          R{register}
        </div>
      </div>
    </div>
  );
};

// Componente para mostrar información detallada de una instrucción
const InstructionTooltip: React.FC<{
  hex: string;
  decoded: any;
  isStall?: boolean;
}> = ({ hex, decoded, isStall }) => {
  if (isStall) {
    return (
      <div className="text-xs space-y-1">
        <div className="font-medium text-orange-600">STALL (Bubble)</div>
        <div className="text-muted-foreground">Pipeline paused due to hazard</div>
      </div>
    );
  }

  return (
    <div className="text-xs space-y-1">
      <div className="font-medium">{hex}</div>
      <div className="text-muted-foreground">
        {decoded.isLoad && <Badge variant="outline" className="text-xs mr-1">Load</Badge>}
        {decoded.isStore && <Badge variant="outline" className="text-xs mr-1">Store</Badge>}
        Type: {decoded.type}
      </div>
      {decoded.readsFrom.length > 0 && (
        <div>Reads: R{decoded.readsFrom.join(', R')}</div>
      )}
      {decoded.writesTo.length > 0 && (
        <div>Writes: R{decoded.writesTo.join(', R')}</div>
      )}
    </div>
  );
};

// src/components/pipeline-visualization.tsx (parte relevante)
export function PipelineVisualization() {
  const {
    instructions,
    currentCycle,
    maxCycles,
    isRunning,
    isFinished,
    forwardingPaths,
    stallsThisCycle,
    stallsEnabled,
    forwardingEnabled,
    pipelineHistory,
  } = useSimulationState();

  const hasStarted = currentCycle > 0;

  // Construir la matriz de visualización desde el historial
  const buildVisualizationMatrix = () => {
    const matrix: { [key: string]: { [cycle: number]: any } } = {};
    
    // Inicializar filas para cada instrucción
    instructions.forEach((_, idx) => {
      matrix[`inst-${idx}`] = {};
    });
    
    // Llenar desde el historial
    pipelineHistory.forEach(snapshot => {
      snapshot.stages.forEach((inst, stageIdx) => {
        if (inst && !inst.isStall) {
          matrix[`inst-${inst.index}`][snapshot.cycle] = {
            stage: stageIdx,
            stageIdx,
            hex: inst.hex,
            isActive: snapshot.cycle === currentCycle,
            isPast: snapshot.cycle < currentCycle,
            isFuture: false,
            decoded: inst.decoded
          };
        }
      });
      
      // Manejar bubbles/stalls
      snapshot.stallsInserted.forEach(stallIdx => {
        const bubbleKey = `bubble-${snapshot.cycle}`;
        if (!matrix[bubbleKey]) {
          matrix[bubbleKey] = {};
        }
        matrix[bubbleKey][snapshot.cycle] = {
          stage: 2, // Los bubbles siempre van en EX
          isStall: true,
          isActive: snapshot.cycle === currentCycle,
          hex: 'BUBBLE'
        };
      });
    });
    
    return matrix;
  };

  const pipelineMatrix = buildVisualizationMatrix();
  
  // Generar columnas para mostrar
  const totalCycles = Math.max(maxCycles, currentCycle + 5);
  const cycleNumbers = Array.from({ length: totalCycles }, (_, i) => i + 1);

  return (
    <Card className="w-full overflow-hidden">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Pipeline Progress</span>
          <div className="flex gap-2">
            {stallsEnabled && (
              <Badge variant="outline" className="text-xs">
                <AlertTriangle className="w-3 h-3 mr-1" />
                Stalls: ON
              </Badge>
            )}
            {forwardingEnabled && (
              <Badge variant="outline" className="text-xs">
                <Zap className="w-3 h-3 mr-1" />
                Forwarding: ON
              </Badge>
            )}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="mb-4 flex flex-wrap gap-4 text-xs">
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 bg-accent rounded"></div>
            <span>Etapa Actual</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 bg-secondary rounded"></div>
            <span>Etapa Pasada</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 bg-orange-200 rounded"></div>
            <span>Stall/Bubble</span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <Table className="min-w-max">
            <TableCaption>
              MIPS instruction pipeline visualization
              {stallsEnabled && " with hazard detection"}
              {forwardingEnabled && " and forwarding"}
            </TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[200px] sticky left-0 bg-card z-10 border-r">
                  Instruction
                </TableHead>
                {cycleNumbers.map((c) => (
                  <TableHead key={`cycle-${c}`} className={cn(
                    "text-center w-20",
                    c === currentCycle && !isFinished && "bg-accent/20"
                  )}>
                    <div className="flex flex-col items-center">
                      <span>Cycle {c}</span>
                      {c === currentCycle && !isFinished && (
                        <Clock className="w-3 h-3 mt-1 text-accent" />
                      )}
                    </div>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {/* Instrucciones normales */}
              {instructions.map((inst, instIndex) => (
                <TableRow key={`inst-${instIndex}`}>
                  <TableCell className="font-mono sticky left-0 bg-card z-10 border-r p-2">
                    <div className="space-y-1">
                      <div className="font-medium">{inst}</div>
                      <div className="text-xs text-muted-foreground">
                        Inst {instIndex + 1}
                      </div>
                    </div>
                  </TableCell>
                  {cycleNumbers.map((c) => {
                    const cellData = pipelineMatrix[`inst-${instIndex}`]?.[c];
                    
                    if (!cellData) {
                      return (
                        <TableCell key={`inst-${instIndex}-cycle-${c}`} 
                          className="text-center w-20 h-16 border-l border-muted/20" />
                      );
                    }

                    const stageData = STAGES[cellData.stage];
                    const hasForwardingFrom = forwardingPaths.some(path => 
                      path.from.instructionIndex === instIndex && 
                      c === currentCycle
                    );
                    const hasForwardingTo = forwardingPaths.some(path => 
                      path.to.instructionIndex === instIndex && 
                      c === currentCycle  
                    );

                    return (
                      <TableCell
                        key={`inst-${instIndex}-cycle-${c}`}
                        className={cn(
                          'text-center w-20 h-16 relative transition-all duration-300 border-l border-muted/20',
                          cellData.isActive && !isFinished ? 'bg-accent text-accent-foreground' :
                          cellData.isPast ? 'bg-secondary/60' :
                          'bg-background',
                          hasForwardingFrom && 'ring-2 ring-blue-400 ring-inset',
                          hasForwardingTo && 'ring-2 ring-green-400 ring-inset'
                        )}
                      >
                        {stageData && (
                          <div className="flex flex-col items-center justify-center h-full">
                            <stageData.icon className="w-5 h-5 mb-1" />
                            <span className="text-xs font-medium">
                              {stageData.name}
                            </span>
                            {hasForwardingFrom && (
                              <div className="absolute -top-1 -right-1 bg-blue-500 text-white text-xs w-4 h-4 rounded-full flex items-center justify-center">
                                →
                              </div>
                            )}
                            {hasForwardingTo && (
                              <div className="absolute -top-1 -left-1 bg-green-500 text-white text-xs w-4 h-4 rounded-full flex items-center justify-center">
                                ←
                              </div>
                            )}
                          </div>
                        )}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
              
              {/* Fila para mostrar bubbles/stalls */}
              {Object.keys(pipelineMatrix).filter(key => key.startsWith('bubble-')).length > 0 && (
                <TableRow className="border-t-2 border-orange-300">
                  <TableCell className="font-mono sticky left-0 bg-orange-50 z-10 border-r p-2">
                    <div className="space-y-1">
                      <div className="font-medium text-orange-600 flex items-center gap-1">
                        <AlertTriangle className="w-4 h-4" />
                        STALLS
                      </div>
                    </div>
                  </TableCell>
                  {cycleNumbers.map((c) => {
                    const hasBubble = Object.keys(pipelineMatrix).some(key => 
                      key.startsWith('bubble-') && pipelineMatrix[key][c]
                    );
                    
                    return (
                      <TableCell key={`bubble-cycle-${c}`} className={cn(
                        'text-center w-20 h-16 border-l border-muted/20',
                        hasBubble && c === currentCycle ? 'bg-orange-300' :
                        hasBubble ? 'bg-orange-200' : ''
                      )}>
                        {hasBubble && (
                          <div className="flex flex-col items-center justify-center h-full">
                            <AlertTriangle className="w-5 h-5 mb-1 text-orange-600" />
                            <span className="text-xs font-medium text-orange-600">BUBBLE</span>
                          </div>
                        )}
                      </TableCell>
                    );
                  })}
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        {/* Stats mejoradas */}
        {hasStarted && (
          <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <div className="p-3 bg-muted/50 rounded-md">
              <div className="font-medium">Hazards Detectados</div>
              <div className="text-2xl font-bold text-orange-600">
                {pipelineHistory.reduce((acc, snapshot) => 
                  acc + snapshot.stallsInserted.length, 0)}
              </div>
              <div className="text-xs text-muted-foreground">total en la simulación</div>
            </div>
            
            <div className="p-3 bg-muted/50 rounded-md">
              <div className="font-medium">Forwarding Activo</div>
              <div className="text-2xl font-bold text-blue-600">
                {forwardingPaths.length}
              </div>
              <div className="text-xs text-muted-foreground">paths en este ciclo</div>
            </div>
            
            <div className="p-3 bg-muted/50 rounded-md">
              <div className="font-medium">Progreso</div>
              <div className="text-2xl font-bold text-green-600">
                {isFinished ? '100' : Math.round((currentCycle / Math.max(maxCycles, 1)) * 100)}%
              </div>
              <div className="text-xs text-muted-foreground">completado</div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}