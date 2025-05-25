"use client";

import type { PropsWithChildren } from 'react';
import * as React from 'react';
import { decodeMIPSInstruction, hasRAWHazard, canForward, type DecodedInstruction } from '@/lib/mips-decoder';

const STAGE_NAMES = ['IF', 'ID', 'EX', 'MEM', 'WB'];

export interface ForwardingPath {
  from: { instructionIndex: number; stage: number };
  to: { instructionIndex: number; stage: number };
  register: number;
}

export interface InstructionState {
  index: number;
  hex: string;
  decoded: DecodedInstruction;
  currentStage: number | null;
  isStall: boolean;
  cycleEntered: number; // Ciclo en que entró al pipeline
}

interface PipelineSnapshot {
  cycle: number;
  stages: (InstructionState | null)[];
  forwardingPaths: ForwardingPath[];
  stallsInserted: number[];
}

interface SimulationState {
  instructions: string[];
  decodedInstructions: DecodedInstruction[];
  instructionStates: InstructionState[];
  currentCycle: number;
  maxCycles: number;
  isRunning: boolean;
  stageCount: number;
  isFinished: boolean;
  stallsEnabled: boolean;
  forwardingEnabled: boolean;
  forwardingPaths: ForwardingPath[];
  stallsThisCycle: number[];
  
  pipelineHistory: PipelineSnapshot[];
  preCalculatedSimulation: PipelineSnapshot[];
  nextInstructionToFetch: number; // Índice de la próxima instrucción a cargar
  totalStallsInserted: number; // Total de stalls insertados hasta ahora
}

interface SimulationActions {
  startSimulation: (submittedInstructions: string[]) => void;
  resetSimulation: () => void;
  pauseSimulation: () => void;
  resumeSimulation: () => void;
  setStallsEnabled: (enabled: boolean) => void;
  setForwardingEnabled: (enabled: boolean) => void;
}

const SimulationStateContext = React.createContext<SimulationState | undefined>(undefined);
const SimulationActionsContext = React.createContext<SimulationActions | undefined>(undefined);

const DEFAULT_STAGE_COUNT = STAGE_NAMES.length;

const initialState: SimulationState = {
  instructions: [],
  currentCycle: 0,
  maxCycles: 0,
  isRunning: false,
  stageCount: DEFAULT_STAGE_COUNT,
  instructionStates: [],
  isFinished: false,
  decodedInstructions: [],
  stallsEnabled: false,
  forwardingEnabled: false,
  forwardingPaths: [],
  stallsThisCycle: [],
  pipelineHistory: [],
  preCalculatedSimulation: [],
  nextInstructionToFetch: 0,
  totalStallsInserted: 0,
};

// Función para pre-calcular toda la simulación
const preCalculateSimulation = (
  instructions: string[],
  decodedInstructions: DecodedInstruction[],
  stallsEnabled: boolean,
  forwardingEnabled: boolean
): PipelineSnapshot[] => {
  const history: PipelineSnapshot[] = [];
  let cycle = 0;
  let fetchPtr = 0;
  let totalStalls = 0;
  let pipeline: (InstructionState | null)[] = Array(DEFAULT_STAGE_COUNT).fill(null);

  // Límite de seguridad para evitar bucles infinitos
  const SAFETY_LIMIT = 1000;

  while (cycle < SAFETY_LIMIT) {
    cycle++;
    const forwardingPaths: ForwardingPath[] = [];
    const stallsThisCycle: number[] = [];
    let needStall = false;

    // 1. Hazard detection for inst in ID
    const instInID = pipeline[1]; // Corrección: ID es la posición 1, no 0
    if (instInID && stallsEnabled) { // Solo verificar hazards si stalls está habilitado
      // Verificar hazards con instrucciones en EX, MEM
      for (let prodStage = 2; prodStage <= 3; prodStage++) {
        const prodInst = pipeline[prodStage];
        if (!prodInst) continue;
        
        // Verificar si hay un hazard RAW
        if (!hasRAWHazard(prodInst.decoded, instInID.decoded)) continue;

        // Ya hay un hazard confirmado
        if (forwardingEnabled) {
          const stageDistance = prodStage - 1; // Corrección: calcular la distancia correcta
          
          try {
            if (canForward(prodInst.decoded, instInID.decoded, stageDistance)) {
              // Crear paths de forwarding
              prodInst.decoded.writesTo.forEach(r => {
                if (instInID.decoded.readsFrom.includes(r)) {
                  forwardingPaths.push({
                    from: { instructionIndex: prodInst.index, stage: prodStage },
                    to:   { instructionIndex: instInID.index, stage: 1 }, // ID es etapa 1
                    register: r
                  });
                }
              });
            } else {
              // Forwarding no es posible, necesitamos un stall
              needStall = true;
              break; // Salir del bucle, ya sabemos que necesitamos un stall
            }
          } catch (error) {
            console.error("Error en canForward:", error);
            // Si hay un error en canForward, lo más seguro es insertar un stall
            needStall = true;
            break;
          }
        } else {
          // Sin forwarding, siempre necesitamos un stall
          needStall = true;
          break;
        }
      }
    }

    // 2. Advance pipeline
    const nextPipeline: (InstructionState | null)[] = Array(DEFAULT_STAGE_COUNT).fill(null);

    if (needStall) {
      // Advance EX→MEM, MEM→WB
      [2, 3].forEach(stage => {
        const inst = pipeline[stage];
        if (inst) {
          const dest = stage + 1;
          if (dest < DEFAULT_STAGE_COUNT) nextPipeline[dest] = { ...inst, currentStage: dest };
        }
      });
      // Keep IF and ID
      [0, 1].forEach(stage => {
        const inst = pipeline[stage];
        if (inst) nextPipeline[stage] = { ...inst };
      });
      // Insert bubble at EX
      const bubble: InstructionState = {
        index: - (cycle + 1),
        hex: 'NOP',
        decoded: {
          hex: 'NOP', opcode: -1, type: 'R', isLoad: false,
          isStore: false, readsFrom: [], writesTo: []
        },
        currentStage: 2,
        isStall: true,
        cycleEntered: cycle
      };
      nextPipeline[2] = bubble;
      stallsThisCycle.push(bubble.index);
      totalStalls++;
    } else {
      // Normal advance for all non-stall insts
      pipeline.forEach((inst, stage) => {
        if (!inst || inst.isStall) return;
        const dest = stage + 1;
        if (dest < DEFAULT_STAGE_COUNT) nextPipeline[dest] = { ...inst, currentStage: dest };
      });
      // Fetch next if IF free
      if (!nextPipeline[0] && fetchPtr < instructions.length) {
        nextPipeline[0] = {
          index: fetchPtr,
          hex: instructions[fetchPtr],
          decoded: decodedInstructions[fetchPtr],
          currentStage: 0,
          isStall: false,
          cycleEntered: cycle
        };
        fetchPtr++;
      }
    }

    // Registrar el snapshot de este ciclo
    history.push({
      cycle,
      stages: nextPipeline,
      forwardingPaths,
      stallsInserted: stallsThisCycle
    });

    // Actualizar pipeline para el siguiente ciclo
    pipeline = nextPipeline;

    // Condición de salida: hemos procesado todas las instrucciones y el pipeline está vacío o solo tiene stalls
    const done = fetchPtr >= instructions.length;
    const empty = pipeline.every(i => !i || i.isStall);
    if (done && empty) break;
  }

  // Si llegamos al límite de seguridad, mostrar advertencia
  if (cycle >= SAFETY_LIMIT) {
    console.warn(`⚠️ Simulación terminada por límite de seguridad (${SAFETY_LIMIT} ciclos)`);
  }

  console.log(`Simulación completada en ${cycle} ciclos con ${totalStalls} stalls`);
  return history;
};


const calculateNextState = (currentState: SimulationState): SimulationState => {
  if (!currentState.isRunning || currentState.isFinished) {
    return currentState;
  }

  const nextCycle = currentState.currentCycle + 1;
  
  // Buscar el snapshot pre-calculado para este ciclo
  const nextSnapshot = currentState.preCalculatedSimulation.find(
    snapshot => snapshot.cycle === nextCycle
  );
  
  if (!nextSnapshot) {
    return {
      ...currentState,
      isFinished: true,
      isRunning: false
    };
  }

  // Convertir las etapas del snapshot a instrucciones activas
  const newInstructionStates = nextSnapshot.stages.filter(inst => inst !== null) as InstructionState[];
  
  // Verificar si la simulación terminó
  const isFinished = nextCycle >= currentState.preCalculatedSimulation.length;

  return {
    ...currentState,
    currentCycle: nextCycle,
    instructionStates: newInstructionStates,
    forwardingPaths: nextSnapshot.forwardingPaths,
    stallsThisCycle: nextSnapshot.stallsInserted,
    pipelineHistory: [...currentState.pipelineHistory, nextSnapshot],
    isFinished,
    isRunning: !isFinished
  };
};


export function SimulationProvider({ children }: PropsWithChildren) {
  const [simulationState, setSimulationState] = React.useState<SimulationState>(initialState);
  const intervalRef = React.useRef<NodeJS.Timeout | null>(null);

  const clearTimer = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };

  const runClock = React.useCallback(() => {
    clearTimer();
    if (!simulationState.isRunning || simulationState.isFinished) return;

    intervalRef.current = setInterval(() => {
      setSimulationState((prevState) => {
        const nextState = calculateNextState(prevState);
        if (nextState.isFinished && !prevState.isFinished) {
          clearTimer();
        }
        return nextState;
      });
    }, 1000); // Más rápido para testing
  }, [simulationState.isRunning, simulationState.isFinished]);

  const resetSimulation = React.useCallback(() => {
    clearTimer();
    setSimulationState(initialState);
  }, []);

  const startSimulation = React.useCallback((submittedInstructions: string[]) => {
    clearTimer();
    if (submittedInstructions.length === 0) {
      resetSimulation();
      return;
    }

    console.log('🚀 Iniciando nueva simulación...');
    const decodedInstructions = submittedInstructions.map(hex => decodeMIPSInstruction(hex));
    
    // Pre-calcular toda la simulación
    const preCalculatedSimulation = preCalculateSimulation(
      submittedInstructions,
      decodedInstructions,
      simulationState.stallsEnabled,
      simulationState.forwardingEnabled
    );
    
    // Calcular ciclos máximos basado en la simulación pre-calculada
    const calculatedMaxCycles = preCalculatedSimulation.length;

    setSimulationState({
      ...initialState,
      instructions: submittedInstructions,
      decodedInstructions,
      instructionStates: [],
      currentCycle: 0,
      maxCycles: calculatedMaxCycles,
      isRunning: true,
      stallsEnabled: simulationState.stallsEnabled,
      forwardingEnabled: simulationState.forwardingEnabled,
      pipelineHistory: [],
      preCalculatedSimulation, // Guardar la simulación pre-calculada
      nextInstructionToFetch: 0,
      totalStallsInserted: 0
    });
  }, [resetSimulation, simulationState.stallsEnabled, simulationState.forwardingEnabled]);
  
  const pauseSimulation = () => {
    setSimulationState((prevState) => {
      if (prevState.isRunning) {
        clearTimer();
        return { ...prevState, isRunning: false };
      }
      return prevState;
    });
  };

  const resumeSimulation = () => {
    setSimulationState((prevState) => {
      if (!prevState.isRunning && prevState.currentCycle > 0 && !prevState.isFinished) {
        return { ...prevState, isRunning: true };
      }
      return prevState;
    });
  };

  const setStallsEnabled = (enabled: boolean) => {
    setSimulationState(prev => ({ ...prev, stallsEnabled: enabled }));
  };

  const setForwardingEnabled = (enabled: boolean) => {
    setSimulationState(prev => ({
      ...prev,
      forwardingEnabled: enabled,
      stallsEnabled: enabled || prev.stallsEnabled
    }));
  };

  React.useEffect(() => {
    if (simulationState.isRunning && !simulationState.isFinished) {
      runClock();
    } else {
      clearTimer();
    }
    return clearTimer;
  }, [simulationState.isRunning, simulationState.isFinished, runClock]);

  const stateValue: SimulationState = simulationState;

  const actionsValue: SimulationActions = React.useMemo(
    () => ({
      startSimulation,
      resetSimulation,
      pauseSimulation,
      resumeSimulation,
      setStallsEnabled,
      setForwardingEnabled,
    }),
    [startSimulation, resetSimulation]
  );

  return (
    <SimulationStateContext.Provider value={stateValue}>
      <SimulationActionsContext.Provider value={actionsValue}>
        {children}
      </SimulationActionsContext.Provider>
    </SimulationStateContext.Provider>
  );
}

export function useSimulationState() {
  const context = React.useContext(SimulationStateContext);
  if (context === undefined) {
    throw new Error('useSimulationState must be used within a SimulationProvider');
  }
  return context;
}

export function useSimulationActions() {
  const context = React.useContext(SimulationActionsContext);
  if (context === undefined) {
    throw new Error('useSimulationActions must be used within a SimulationProvider');
  }
  return context;
}