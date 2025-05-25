"use client";

import * as React from 'react';
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
import { AlertTriangle, Zap, Clock, Download, Code2, Cpu, MemoryStick, CheckSquare } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSimulationState } from '@/context/SimulationContext';
import { decodeHexToInstructions } from '@/lib/mips-decoder';
import ForwardingArrow from './forwarding-arrow';
import InstructionTooltip from './instruction-detail';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export const STAGES = [
  { name: 'IF', icon: Download, description: 'Instruction Fetch' },
  { name: 'ID', icon: Code2, description: 'Instruction Decode' },
  { name: 'EX', icon: Cpu, description: 'Execute' },
  { name: 'MEM', icon: MemoryStick, description: 'Memory Access' },
  { name: 'WB', icon: CheckSquare, description: 'Write Back' },
];

export function PipelineVisualization() {
  const {
    instructions,
    currentCycle,
    maxCycles,
    isFinished,
    forwardingPaths,
    stallsEnabled,
    forwardingEnabled,
    pipelineHistory,
    decodedInstructions
  } = useSimulationState();

  const hasStarted = currentCycle > 0;
  const [pipelineMatrix, setPipelineMatrix] = React.useState<{ [key: string]: { [cycle: number]: any } }>({});

  // Referencia para el contenedor de la tabla
  const tableContainerRef = React.useRef<HTMLDivElement>(null);
  
  // Estado para almacenar las posiciones de las celdas
  const [cellPositions, setCellPositions] = React.useState<{[key: string]: DOMRect}>({});
  
  // Función para calcular y almacenar las posiciones de las celdas relevantes
  const calculateCellPositions = React.useCallback(() => {
    if (!tableContainerRef.current) return;
    
    const newPositions: {[key: string]: DOMRect} = {};
    const cells = tableContainerRef.current.querySelectorAll('[data-cell-id]');
    
    cells.forEach((cell) => {
      const cellId = cell.getAttribute('data-cell-id');
      if (cellId) {
        newPositions[cellId] = cell.getBoundingClientRect();
      }
    });
    
    setCellPositions(newPositions);
  }, []);
  
  // Calcular posiciones cuando cambia el ciclo actual o el historial
  React.useEffect(() => {
    calculateCellPositions();
    // Agregar un pequeño retraso para asegurar que el DOM esté actualizado
    const timer = setTimeout(calculateCellPositions, 100);
    return () => clearTimeout(timer);
  }, [currentCycle, pipelineHistory, calculateCellPositions]);
  
  // Recalcular posiciones en el resize de la ventana
  React.useEffect(() => {
    window.addEventListener('resize', calculateCellPositions);
    return () => window.removeEventListener('resize', calculateCellPositions);
  }, [calculateCellPositions]);

  // Construir la matriz de visualización desde el historial
  const buildVisualizationMatrix = () => {
    const matrix: { [key: string]: { [cycle: number]: any } } = {};

    instructions.forEach((_, idx) => {
      matrix[`inst-${idx}`] = {};
    });
    
    // Objeto para rastrear la última etapa vista para cada instrucción
    const lastStageByInst: { [instIndex: number]: { cycle: number, stage: number } } = {};
    
    // Rastrear qué etapas específicas han participado en forwarding
    const stagesWithForwarding = new Set<string>(); // formato: "instIndex-stage"
    
    // Procesar el historial de manera ordenada por ciclo
    const sortedHistory = [...pipelineHistory].sort((a, b) => a.cycle - b.cycle);
    
    // Primer pasa: identificar todas las etapas específicas que han participado en forwarding
    sortedHistory.forEach(snapshot => {
      if (snapshot.forwardingPaths && snapshot.forwardingPaths.length > 0) {
        snapshot.forwardingPaths.forEach(path => {
          // Marcar la etapa específica que envía el forwarding
          stagesWithForwarding.add(`${path.from.instructionIndex}-${path.from.stage}`);
          // Marcar la etapa específica que recibe el forwarding
          stagesWithForwarding.add(`${path.to.instructionIndex}-${path.to.stage}`);
        });
      }
    });
    
    sortedHistory.forEach(snapshot => {
      const cycle = snapshot.cycle;
      
      // Asegurarse de que tengamos datos válidos
      if (!snapshot.stages || !Array.isArray(snapshot.stages)) return;
      
      // Determinar si hay stalls en este ciclo
      const hasStallsThisCycle = snapshot.stallsInserted && snapshot.stallsInserted.length > 0;

      // Procesar las etapas de cada instrucción en este ciclo
      snapshot.stages.forEach((inst, stageIdx) => {
        if (!inst) return; // Omitir etapas vacías
        
        // Solo procesar instrucciones reales (no stalls)
        if (!inst.isStall) {
          const instIndex = inst.index;
          if (instIndex === undefined || instIndex < 0 || instIndex >= instructions.length) {
            return; // Ignorar instrucciones con índices inválidos
          }

          // Verificar si esta etapa es una regresión (excepto en el primer ciclo)
          const lastStage = lastStageByInst[instIndex];
          if (lastStage) {
            // Para etapas WB (4), permitimos que aparezca solo una vez
            if (stageIdx === 4 && lastStage.stage === 4) return; // No duplicar etapas WB
            
            // No permitir retroceder a etapas anteriores
            if (stageIdx < lastStage.stage && cycle > lastStage.cycle) return;
          }

          // Actualizar el seguimiento de la última etapa para esta instrucción
          if (!lastStage || stageIdx >= lastStage.stage || cycle < lastStage.cycle) {
            lastStageByInst[instIndex] = { cycle, stage: stageIdx };
          }
          
          // Determinar si esta instrucción está afectada por el stall
          let isStalled = false;
          if (hasStallsThisCycle) {
            // Si hay stalls, las etapas IF e ID se quedan congeladas
            if (stageIdx <= 1) { // IF (0) e ID (1) se quedan donde están
              isStalled = true;
            }
          }

          // Determinar si hay forwarding activo en esta celda específica
          let hasForwardingFromActive = false;
          let hasForwardingToActive = false;
          
          if (snapshot.forwardingPaths && snapshot.forwardingPaths.length > 0) {
            hasForwardingFromActive = snapshot.forwardingPaths.some(path => 
              path.from.instructionIndex === instIndex && path.from.stage === stageIdx
            );
            hasForwardingToActive = snapshot.forwardingPaths.some(path => 
              path.to.instructionIndex === instIndex && path.to.stage === stageIdx
            );
          }
          
          // Determinar si esta instrucción ha participado en forwarding en algún momento
          const hasParticipatedInForwarding = stagesWithForwarding.has(`${instIndex}-${stageIdx}`);
          
          // Registrar la etapa en la matriz
          matrix[`inst-${instIndex}`][cycle] = {
            stage: stageIdx,
            stageIdx,
            hex: inst.hex,
            isActive: cycle === currentCycle,
            isPast: cycle < currentCycle,
            isFuture: false,
            decoded: inst.decoded,
            isStalled: isStalled,
            hasForwardingFromActive: hasForwardingFromActive,
            hasForwardingToActive: hasForwardingToActive,
            hasParticipatedInForwarding: hasParticipatedInForwarding // Nueva propiedad
          };
        }
      });
      
      // Manejar bubbles/stalls
      if (snapshot.stallsInserted && Array.isArray(snapshot.stallsInserted)) {
        snapshot.stallsInserted.forEach(stallIdx => {
          const bubbleKey = `bubble-${cycle}-${stallIdx}`;
          if (!matrix[bubbleKey]) {
            matrix[bubbleKey] = {};
          }
          matrix[bubbleKey][cycle] = {
            stage: 2, // Los bubbles siempre van en EX
            isStall: true,
            isActive: cycle === currentCycle,
            hex: 'BUBBLE'
          };
        });
      }
    });
    
    return matrix;
  };

  React.useEffect(() => {
    const matrix = buildVisualizationMatrix();
    setPipelineMatrix(matrix);
  }, [instructions, currentCycle, pipelineHistory]);

  const cycleNumbers = Array.from({ length: maxCycles }, (_, i) => i + 1);

  return (
    <Card className="w-full overflow-hidden">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Pipeline Progress</span>
          <div className="flex gap-2">
            <Badge 
              variant={stallsEnabled ? "default" : "outline"}
              className={cn(
                "text-xs transition-colors",
                stallsEnabled 
                  ? "bg-orange-500 hover:bg-orange-600 text-white" 
                  : "bg-transparent text-orange-500 border-orange-500"
              )}
            >
              <AlertTriangle className={cn("w-3 h-3 mr-1", stallsEnabled ? "text-white" : "text-orange-500")} />
              Stalls: {stallsEnabled ? 'ON' : 'OFF'}
            </Badge>
            <Badge 
              variant={forwardingEnabled ? "default" : "outline"}
              className={cn(
                "text-xs transition-colors",
                forwardingEnabled 
                  ? "bg-purple-500 hover:bg-purple-600 text-white" 
                  : "bg-transparent text-purple-500 border-purple-500",
                !stallsEnabled && "opacity-50" // Atenuar si stalls está desactivado
              )}
            >
              <Zap className={cn("w-3 h-3 mr-1", forwardingEnabled ? "text-white" : "text-purple-500")} />
              Forwarding: {forwardingEnabled ? 'ON' : 'OFF'}
            </Badge>
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
            <div className="w-3 h-3 bg-purple-200 border border-purple-300 rounded"></div>
            <span>Forwarding Activo</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-5 h-5 bg-purple-700 text-white text-xs rounded-full flex items-center justify-center">
              <span className="text-[10px]">S</span>
            </div>
            <span>Fuente de Forwarding</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-5 h-5 bg-purple-700 text-white text-xs rounded-full flex items-center justify-center">
              <span className="text-[10px]">D</span>
            </div>
            <span>Destino de Forwarding</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 bg-orange-200 border border-orange-300 rounded"></div>
            <span>Etapa en Stall</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 bg-orange-300 rounded"></div>
            <span>Bubble/Stall Activo</span>
          </div>
        </div>

        <div className="overflow-x-auto relative" ref={tableContainerRef}>
          <TooltipProvider>
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
                          {(() => {
                            const decoded = decodedInstructions[instIndex];
                            return (decodeHexToInstructions(decoded, instIndex))
                          })()}
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
                      const hasActiveForwarding = cellData.hasForwardingFromActive || cellData.hasForwardingToActive;
                      const hasForwardingHistory = cellData.hasParticipatedInForwarding;

                      // Buscar información de forwarding para este ciclo y celda
                      const forwardingInfo = forwardingPaths.filter(path => 
                        (path.from.instructionIndex === instIndex && path.from.stage === cellData.stage) || 
                        (path.to.instructionIndex === instIndex && path.to.stage === cellData.stage)
                      );

                      return (
                        <TableCell
                          key={`inst-${instIndex}-cycle-${c}`}
                          data-cell-id={`cell-${instIndex}-${c}-${cellData.stage}`}
                          className={cn(
                            'text-center w-20 h-16 relative transition-all duration-300 border-l border-muted/20',
                            // Prioridad de colores: Forwarding activo > Forwarding histórico > Stall > Estado normal
                            hasActiveForwarding ? 'bg-purple-300 border-purple-400' : // Forwarding activo (más intenso)
                            hasForwardingHistory ? 'bg-purple-100 border-purple-200' : // Forwarding histórico (más sutil)
                            cellData.isStalled ? 'bg-orange-200 border-orange-300' : // Color de stall
                            cellData.isActive && !isFinished ? 'bg-accent text-accent-foreground' :
                            cellData.isPast ? 'bg-secondary/60' :
                            'bg-background'
                          )}
                        >
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className="flex flex-col items-center justify-center h-full w-full cursor-pointer">
                                {stageData && (
                                  <>
                                    <stageData.icon className={cn(
                                      "w-5 h-5 mb-1",
                                      hasActiveForwarding ? "text-purple-800" : // Forwarding activo (más oscuro)
                                      hasForwardingHistory ? "text-purple-600" : // Forwarding histórico (medio)
                                      cellData.isStalled ? "text-orange-700" : ""
                                    )} />
                                    <span className={cn(
                                      "text-xs font-medium",
                                      hasActiveForwarding ? "text-purple-800" : // Forwarding activo (más oscuro)
                                      hasForwardingHistory ? "text-purple-600" : // Forwarding histórico (medio)
                                      cellData.isStalled ? "text-orange-700" : ""
                                    )}>
                                      {stageData.name}
                                    </span>
                                    
                                    {/* Indicadores de forwarding mejorados */}
                                    {forwardingInfo.map((fwInfo, idx) => {
                                      // Determinar si esta celda es fuente o destino
                                      const isSource = fwInfo.from.instructionIndex === instIndex && fwInfo.from.stage === cellData.stage;
                                      const isDestination = fwInfo.to.instructionIndex === instIndex && fwInfo.to.stage === cellData.stage;
                                      
                                      if (!isSource && !isDestination) return null;
                                      
                                      return (
                                        <div 
                                          key={`fw-${idx}`}
                                          className={cn(
                                            "absolute bg-purple-700 text-white text-xs rounded-full flex items-center justify-center shadow-md",
                                            isSource 
                                              ? "-top-2 -right-2 w-6 h-6 z-30" 
                                              : "-top-2 -left-2 w-6 h-6 z-30"
                                          )}
                                          title={isSource 
                                            ? `Envía R${fwInfo.register} a instrucción ${fwInfo.to.instructionIndex + 1}` 
                                            : `Recibe R${fwInfo.register} de instrucción ${fwInfo.from.instructionIndex + 1}`
                                          }
                                        >
                                          <span className="text-[10px] font-bold">{isSource ? 'S' : 'D'}</span>
                                          <span className="text-[8px] absolute bottom-0 right-0 bg-purple-900 rounded-full w-3 h-3 flex items-center justify-center">
                                            {fwInfo.register}
                                          </span>
                                        </div>
                                      );
                                    })}
                                  </>
                                )}
                              </div>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="p-2 max-w-xs bg-white shadow-lg rounded border z-50">
                              <InstructionTooltip 
                                hex={inst}
                                decoded={cellData.decoded || {
                                  type: 'Unknown',
                                  readsFrom: [],
                                  writesTo: [],
                                  isLoad: false,
                                  isStore: false
                                }}
                                isStall={false}
                              />
                              {/* Añadir información de forwarding al tooltip si existe */}
                              {forwardingInfo.length > 0 && (
                                <div className="mt-2 pt-2 border-t border-gray-200">
                                  <div className="font-medium text-xs text-purple-700">Forwarding activo:</div>
                                  <ul className="text-xs mt-1 space-y-1">
                                    {forwardingInfo.map((fw, idx) => {
                                      const isSource = fw.from.instructionIndex === instIndex && fw.from.stage === cellData.stage;
                                      return (
                                        <li key={idx} className="flex items-center gap-1">
                                          {isSource 
                                            ? `Envía R${fw.register} a instrucción ${fw.to.instructionIndex + 1} (${STAGES[fw.to.stage].name})`
                                            : `Recibe R${fw.register} de instrucción ${fw.from.instructionIndex + 1} (${STAGES[fw.from.stage].name})`
                                          }
                                        </li>
                                      );
                                    })}
                                  </ul>
                                </div>
                              )}
                            </TooltipContent>
                          </Tooltip>
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
                
                {/* Bubbles/Stalls */}
                {Object.keys(pipelineMatrix)
                  .filter(key => key.startsWith('bubble-'))
                  .map((bubbleKey) => {
                    // Extraer el ciclo del bubble key (bubble-[cycle]-[stallIdx])
                    const cyclePart = bubbleKey.split('-')[1];
                    
                    return (
                      <TableRow key={bubbleKey} className="border-t border-orange-300">
                        <TableCell className="font-mono sticky left-0 bg-orange-50 z-10 border-r p-2">
                          <div className="space-y-1">
                            <div className="font-medium text-orange-600 flex items-center gap-1">
                              <AlertTriangle className="w-4 h-4" />
                              STALL (Ciclo {cyclePart})
                            </div>
                          </div>
                        </TableCell>
                        {cycleNumbers.map((c) => {
                          const bubbleData = pipelineMatrix[bubbleKey][c];
                          
                          return (
                            <TableCell key={`${bubbleKey}-cycle-${c}`} className={cn(
                              'text-center w-20 h-16 border-l border-muted/20',
                              bubbleData && c === currentCycle ? 'bg-orange-300' :
                              bubbleData ? 'bg-orange-200' : ''
                            )}>
                              {bubbleData && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <div className="flex flex-col items-center justify-center h-full cursor-pointer">
                                      <AlertTriangle className="w-5 h-5 mb-1 text-orange-600" />
                                      <span className="text-xs font-medium text-orange-600">BUBBLE</span>
                                    </div>
                                  </TooltipTrigger>
                                  <TooltipContent side="top" className="p-2 max-w-xs bg-white shadow-lg rounded border z-50">
                                    <InstructionTooltip 
                                      hex="BUBBLE"
                                      decoded={{}}
                                      isStall={true}
                                    />
                                  </TooltipContent>
                                </Tooltip>
                              )}
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    );
                })}
              </TableBody>
            </Table>
          </TooltipProvider>
          
          {/* Capa para las flechas de forwarding */}
          <div className="absolute inset-0 pointer-events-none">
            {forwardingPaths.map((path, index) => {
              const fromCellId = `cell-${path.from.instructionIndex}-${currentCycle}-${path.from.stage}`;
              const toCellId = `cell-${path.to.instructionIndex}-${currentCycle}-${path.to.stage}`;
              
              const fromRect = cellPositions[fromCellId];
              const toRect = cellPositions[toCellId];
              
              if (!fromRect || !toRect) return null;
              
              // Calcular posición y dimensiones para la flecha
              const containerRect = tableContainerRef.current?.getBoundingClientRect();
              if (!containerRect) return null;
              
              const left = (fromRect.left - containerRect.left) + (fromRect.width / 2);
              const top = (fromRect.top - containerRect.top) + (fromRect.height / 2);
              const width = ((toRect.left - containerRect.left) + (toRect.width / 2)) - left;
              
              return (
                <div 
                  key={`arrow-${index}`}
                  className="absolute bg-purple-500 h-1"
                  style={{
                    left: `${left}px`,
                    top: `${top}px`,
                    width: `${Math.abs(width)}px`,
                    transform: width < 0 ? 'scaleX(-1)' : 'none'
                  }}
                >
                  {/* Punta de flecha */}
                  <div className="absolute right-0 top-1/2 transform -translate-y-1/2 w-0 h-0 border-l-4 border-l-purple-500 border-y-4 border-y-transparent" />
                  
                  {/* Etiqueta de registro */}
                  <div className="absolute top-0 left-1/2 transform -translate-x-1/2 -translate-y-full bg-purple-500 text-white text-xs px-1 rounded">
                    R{path.register}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {hasStarted && (
          <div className="mt-4 grid grid-cols-1 md:grid-cols-4 gap-4 text-sm">
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
              <div className="text-2xl font-bold text-purple-600">
                {forwardingPaths.length}
              </div>
              <div className="text-xs text-muted-foreground">paths en este ciclo</div>
            </div>
            
            <div className="p-3 bg-muted/50 rounded-md">
              <div className="font-medium">Total Forwarding</div>
              <div className="text-2xl font-bold text-purple-600">
                {pipelineHistory.reduce((acc, snapshot) => 
                  acc + (snapshot.forwardingPaths?.length || 0), 0)}
              </div>
              <div className="text-xs text-muted-foreground">paths totales</div>
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