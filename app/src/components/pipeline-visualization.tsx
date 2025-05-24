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

export function PipelineVisualization() {
  const {
    instructions,
    instructionStates,
    currentCycle,
    maxCycles,
    isRunning,
    isFinished,
    forwardingPaths,
    stallsThisCycle,
    stallsEnabled,
    forwardingEnabled,
  } = useSimulationState();

  // Derivar el estado de si la simulación ha comenzado
  const hasStarted = currentCycle > 0;

  // Generar columnas para mostrar - necesitamos más columnas para acomodar stalls
  const totalCyclesToDisplay = Math.max(maxCycles, currentCycle + 5);
  const cycleNumbers = Array.from({ length: totalCyclesToDisplay }, (_, i) => i + 1);

  // Crear una matriz que represente el estado REAL del pipeline
  // Esta vez usaremos el estado actual de las instrucciones, no una fórmula
  const pipelineMatrix: { [key: string]: { [cycle: number]: any } } = {};

  // Inicializar la matriz
  instructions.forEach((hex, instIndex) => {
    pipelineMatrix[instIndex] = {};
  });

  // Llenar la matriz con el estado actual REAL de las instrucciones
  instructionStates.forEach(instState => {
    if (instState.isStall) {
      // Manejar bubbles/stalls
      const stallKey = `stall-${instState.index}`;
      if (!pipelineMatrix[stallKey]) {
        pipelineMatrix[stallKey] = {};
      }
      
      if (instState.currentStage !== null) {
        pipelineMatrix[stallKey][currentCycle] = {
          stage: instState.currentStage,
          isStall: true,
          isActive: true,
          isPast: false,
          isFuture: false,
          hex: instState.hex,
          decoded: instState.decoded
        };
      }
    } else {
      // Manejar instrucciones normales
      if (instState.currentStage !== null && instState.index >= 0) {
        pipelineMatrix[instState.index][currentCycle] = {
          stage: instState.currentStage,
          isStall: false,
          isActive: true,
          isPast: false,
          isFuture: false,
          hex: instState.hex,
          decoded: instState.decoded
        };
      }
    }
  });

  // Para ciclos pasados, necesitamos reconstruir el historial
  // Esto es una aproximación - en una implementación completa mantendríamos historial
  for (let cycle = 1; cycle < currentCycle; cycle++) {
    instructions.forEach((hex, instIndex) => {
      // Aproximación: calcular dónde habría estado esta instrucción en ciclos pasados
      // considerando que podría haber habido stalls
      const expectedStage = cycle - instIndex - 1;
      if (expectedStage >= 0 && expectedStage < STAGES.length) {
        // Solo mostrar si no hay información más reciente
        if (!pipelineMatrix[instIndex][cycle]) {
          pipelineMatrix[instIndex][cycle] = {
            stage: expectedStage,
            isStall: false,
            isActive: false,
            isPast: true,
            isFuture: false,
            hex: hex,
            decoded: null // No necesitamos decodificación para estados pasados
          };
        }
      }
    });
  }

  // Para ciclos futuros, mostrar proyecciones (si no hay más stalls)
  for (let cycle = currentCycle + 1; cycle <= totalCyclesToDisplay; cycle++) {
    instructions.forEach((hex, instIndex) => {
      const expectedStage = cycle - instIndex - 1;
      if (expectedStage >= 0 && expectedStage < STAGES.length) {
        if (!pipelineMatrix[instIndex][cycle]) {
          pipelineMatrix[instIndex][cycle] = {
            stage: expectedStage,
            isStall: false,
            isActive: false,
            isPast: false,
            isFuture: true,
            hex: hex,
            decoded: null
          };
        }
      }
    });
  }

  return (
    <Card className="w-full overflow-hidden">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Pipeline Progress</span>
          <div className="flex gap-2">
            {stallsEnabled && (
              <Badge variant="outline" className="text-xs">
                <AlertTriangle className="w-3 h-3 mr-1" />
                Stalls: {stallsEnabled ? 'ON' : 'OFF'}
              </Badge>
            )}
            {forwardingEnabled && (
              <Badge variant="outline" className="text-xs">
                <Zap className="w-3 h-3 mr-1" />
                Forwarding: {forwardingEnabled ? 'ON' : 'OFF'}
              </Badge>
            )}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* Legend */}
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
          {forwardingEnabled && (
            <div className="flex items-center gap-1">
              <ArrowRight className="w-3 h-3 text-blue-500" />
              <span>Forwarding Path</span>
            </div>
          )}
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
                    const cellState = pipelineMatrix[instIndex]?.[c];
                    
                    if (!cellState) {
                      return (
                        <TableCell key={`inst-${instIndex}-cycle-${c}`} className="text-center w-20 h-16 border-l border-muted/20" />
                      );
                    }

                    const currentStageData = STAGES[cellState.stage];
                    const isCurrentCycle = c === currentCycle;
                    const isActiveCycle = cellState.isActive && isCurrentCycle;
                    const isPastCycle = cellState.isPast;
                    const isFutureCycle = cellState.isFuture;
                    
                    // Verificar si hay forwarding desde/hacia esta célula
                    const hasForwardingFrom = forwardingPaths.some(path => 
                      path.from.instructionIndex === instIndex && 
                      path.from.stage === cellState.stage &&
                      isCurrentCycle
                    );
                    
                    const hasForwardingTo = forwardingPaths.some(path => 
                      path.to.instructionIndex === instIndex && 
                      path.to.stage === cellState.stage &&
                      isCurrentCycle
                    );

                    return (
                      <TableCell
                        key={`inst-${instIndex}-cycle-${c}`}
                        className={cn(
                          'text-center w-20 h-16 relative transition-all duration-500 border-l border-muted/20',
                          // Coloreado basado en el estado real
                          isFinished ? 'bg-background' :
                          isActiveCycle && isRunning ? 'bg-accent text-accent-foreground animate-pulse-bg' :
                          isActiveCycle ? 'bg-accent text-accent-foreground' :
                          isPastCycle ? 'bg-secondary/60 text-secondary-foreground' :
                          isFutureCycle ? 'bg-muted/30 text-muted-foreground' :
                          'bg-background',
                          // Indicadores de forwarding
                          hasForwardingFrom && 'ring-2 ring-blue-400 ring-inset',
                          hasForwardingTo && 'ring-2 ring-green-400 ring-inset'
                        )}
                      >
                        {currentStageData && !isFinished && (
                          <div className="flex flex-col items-center justify-center h-full relative">
                            <currentStageData.icon className={cn(
                              "w-5 h-5 mb-1",
                              isFutureCycle && "opacity-40"
                            )} aria-hidden="true" />
                            <span className={cn(
                              "text-xs font-medium",
                              isFutureCycle && "opacity-40"
                            )}>
                              {currentStageData.name}
                            </span>
                            
                            {/* Indicadores de forwarding */}
                            {hasForwardingFrom && (
                              <div className="absolute -top-1 -right-1 bg-blue-500 text-white text-xs px-1 rounded-full leading-none">
                                →
                              </div>
                            )}
                            {hasForwardingTo && (
                              <div className="absolute -top-1 -left-1 bg-green-500 text-white text-xs px-1 rounded-full leading-none">
                                ←
                              </div>
                            )}
                            
                            {/* Mostrar número de ciclo para debugging si es necesario */}
                            {isActiveCycle && stallsEnabled && (
                              <div className="absolute bottom-0 right-0 text-xs opacity-50">
                                C{c}
                              </div>
                            )}
                          </div>
                        )}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}

              {/* Fila separada para mostrar stalls cuando ocurren */}
              {Object.keys(pipelineMatrix).some(key => key.startsWith('stall-')) && (
                <TableRow className="border-t-2 border-dashed border-orange-300 bg-orange-50/50">
                  <TableCell className="font-mono sticky left-0 bg-orange-50 z-10 border-r p-2">
                    <div className="space-y-1">
                      <div className="font-medium text-orange-600 flex items-center gap-1">
                        <AlertTriangle className="w-4 h-4" />
                        BUBBLES
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Pipeline Stalls
                      </div>
                    </div>
                  </TableCell>
                  {cycleNumbers.map((c) => {
                    // Buscar si hay algún stall en este ciclo
                    const stallInThisCycle = Object.keys(pipelineMatrix).find(key => 
                      key.startsWith('stall-') && pipelineMatrix[key][c]?.isStall
                    );
                    
                    const cellState = stallInThisCycle ? pipelineMatrix[stallInThisCycle][c] : null;
                    
                    return (
                      <TableCell key={`stall-cycle-${c}`} className={cn(
                        'text-center w-20 h-16 border-l border-muted/20',
                        cellState ? 'bg-orange-200 animate-pulse-bg' : 'bg-orange-50/20'
                      )}>
                        {cellState && (
                          <div className="flex flex-col items-center justify-center h-full">
                            <AlertTriangle className="w-5 h-5 mb-1 text-orange-600" />
                            <span className="text-xs font-medium text-orange-600">NOP</span>
                            <div className="absolute bottom-0 right-0 text-xs opacity-50 text-orange-500">
                              C{c}
                            </div>
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

        {/* Información adicional sobre forwarding paths activos */}
        {forwardingPaths.length > 0 && (
          <div className="mt-4 p-3 bg-blue-50 rounded-md">
            <h4 className="font-medium text-sm mb-2 flex items-center gap-2">
              <Zap className="w-4 h-4 text-blue-600" />
              Active Forwarding Paths (Cycle {currentCycle})
            </h4>
            <div className="space-y-1">
              {forwardingPaths.map((path, idx) => (
                <div key={idx} className="text-xs flex items-center gap-2">
                  <span>Inst {path.from.instructionIndex + 1} ({STAGES[path.from.stage].name})</span>
                  <ArrowRight className="w-3 h-3 text-blue-500" />
                  <span>Inst {path.to.instructionIndex + 1} ({STAGES[path.to.stage].name})</span>
                  <Badge variant="outline" className="text-xs">R{path.register}</Badge>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Estadísticas de hazards */}
        {(stallsEnabled || forwardingEnabled) && hasStarted && (
          <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <div className="p-3 bg-muted/50 rounded-md">
              <div className="font-medium">Hazards Detectados</div>
              <div className="text-2xl font-bold text-orange-600">
                {stallsThisCycle.length}
              </div>
              <div className="text-xs text-muted-foreground">en este ciclo</div>
            </div>
            
            <div className="p-3 bg-muted/50 rounded-md">
              <div className="font-medium">Forwarding Activo</div>
              <div className="text-2xl font-bold text-blue-600">
                {forwardingPaths.length}
              </div>
              <div className="text-xs text-muted-foreground">paths actuales</div>
            </div>
            
            <div className="p-3 bg-muted/50 rounded-md">
              <div className="font-medium">Progreso</div>
              <div className="text-2xl font-bold text-green-600">
                {Math.round((currentCycle / Math.max(maxCycles, 1)) * 100)}%
              </div>
              <div className="text-xs text-muted-foreground">completado</div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}