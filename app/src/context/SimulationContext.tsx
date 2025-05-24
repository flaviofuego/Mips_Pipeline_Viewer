// src/context/SimulationContext.tsx
"use client";

import type { PropsWithChildren } from 'react';
import * as React from 'react';
import { decodeMIPSInstruction, hasRAWHazard, canForward, type DecodedInstruction } from '@/lib/mips-decoder';

const STAGE_NAMES = ['IF', 'ID', 'EX', 'MEM', 'WB'] as const;
type StageName = typeof STAGE_NAMES[number];

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

// Nuevo tipo para mantener el historial completo
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
  
  // Nuevo: historial completo del pipeline
  pipelineHistory: PipelineSnapshot[];
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
  decodedInstructions: [],
  instructionStates: [],
  currentCycle: 0,
  maxCycles: 0,
  isRunning: false,
  stageCount: DEFAULT_STAGE_COUNT,
  isFinished: false,
  stallsEnabled: false,
  forwardingEnabled: false,
  forwardingPaths: [],
  stallsThisCycle: [],
  pipelineHistory: [],
  nextInstructionToFetch: 0,
  totalStallsInserted: 0,
};

const calculateNextState = (currentState: SimulationState): SimulationState => {
  console.log(`\n======= CICLO ${currentState.currentCycle + 1} =======`);
  
  if (!currentState.isRunning || currentState.isFinished) {
    return currentState;
  }

  const nextCycle = currentState.currentCycle + 1;
  const newForwardingPaths: ForwardingPath[] = [];
  const newStallsThisCycle: number[] = [];
  
  // Crear el estado actual del pipeline (5 etapas)
  const currentPipeline: (InstructionState | null)[] = new Array(5).fill(null);
  
  // Llenar el pipeline actual con las instrucciones activas
  currentState.instructionStates.forEach(inst => {
    if (inst.currentStage !== null && !inst.isStall) {
      currentPipeline[inst.currentStage] = inst;
    }
  });

  // Detectar hazards
  let needsStall = false;
  const instInIF = currentPipeline[0];
  const instInID = currentPipeline[1];
  const instInEX = currentPipeline[2];
  const instInMEM = currentPipeline[3];
  const instInWB = currentPipeline[4];

  if (currentState.stallsEnabled && instInID) {
    // Verificar hazard con instrucción en EX
    if (instInEX && hasRAWHazard(instInEX.decoded, instInID.decoded)) {
      if (currentState.forwardingEnabled && canForward(instInEX.decoded, instInID.decoded, 1)) {
        console.log(`✅ Forwarding: EX→ID para registro ${instInEX.decoded.writesTo[0]}`);
        instInEX.decoded.writesTo.forEach(reg => {
          if (instInID.decoded.readsFrom.includes(reg)) {
            newForwardingPaths.push({
              from: { instructionIndex: instInEX.index, stage: 2 },
              to: { instructionIndex: instInID.index, stage: 1 },
              register: reg
            });
          }
        });
      } else {
        console.log(`🛑 STALL necesario: hazard entre EX e ID`);
        needsStall = true;
      }
    }
    
    // Verificar hazard con instrucción en MEM (especialmente load-use)
    if (instInMEM && hasRAWHazard(instInMEM.decoded, instInID.decoded)) {
      if (instInMEM.decoded.isLoad) {
        console.log(`🛑 Load-use hazard detectado!`);
        needsStall = true;
      } else if (currentState.forwardingEnabled && canForward(instInMEM.decoded, instInID.decoded, 2)) {
        console.log(`✅ Forwarding: MEM→ID para registro ${instInMEM.decoded.writesTo[0]}`);
        instInMEM.decoded.writesTo.forEach(reg => {
          if (instInID.decoded.readsFrom.includes(reg)) {
            newForwardingPaths.push({
              from: { instructionIndex: instInMEM.index, stage: 3 },
              to: { instructionIndex: instInID.index, stage: 1 },
              register: reg
            });
          }
        });
      }
    }
  }

  // Crear el nuevo estado del pipeline
  const nextPipeline: (InstructionState | null)[] = new Array(5).fill(null);
  
  if (needsStall) {
    console.log("Insertando BUBBLE en EX");
    
    // EX, MEM, WB avanzan normalmente
    if (instInEX) {
      const newStage = instInEX.currentStage! + 1;
      if (newStage < 5) {
        nextPipeline[newStage] = { ...instInEX, currentStage: newStage };
      }
    }
    if (instInMEM) {
      const newStage = instInMEM.currentStage! + 1;
      if (newStage < 5) {
        nextPipeline[newStage] = { ...instInMEM, currentStage: newStage };
      }
    }
    // WB sale del pipeline
    
    // IF e ID se quedan donde están
    if (instInIF) {
      nextPipeline[0] = { ...instInIF };
    }
    if (instInID) {
      nextPipeline[1] = { ...instInID };
    }
    
    // Insertar bubble en EX
    const bubble: InstructionState = {
      index: -1000 - nextCycle, // Índice único negativo
      hex: 'NOP',
      decoded: {
        hex: 'NOP',
        opcode: -1,
        type: 'R',
        isLoad: false,
        isStore: false,
        readsFrom: [],
        writesTo: []
      },
      currentStage: 2,
      isStall: true,
      cycleEntered: nextCycle
    };
    nextPipeline[2] = bubble;
    newStallsThisCycle.push(bubble.index);
    
  } else {
    // Avance normal: todas las instrucciones avanzan
    currentPipeline.forEach((inst, stage) => {
      if (inst && !inst.isStall) {
        const newStage = stage + 1;
        if (newStage < 5) {
          nextPipeline[newStage] = { ...inst, currentStage: newStage };
        }
      }
    });
    
    // Si hay espacio en IF y quedan instrucciones, cargar la siguiente
    if (!nextPipeline[0] && currentState.nextInstructionToFetch < currentState.instructions.length) {
      const newInst: InstructionState = {
        index: currentState.nextInstructionToFetch,
        hex: currentState.instructions[currentState.nextInstructionToFetch],
        decoded: currentState.decodedInstructions[currentState.nextInstructionToFetch],
        currentStage: 0,
        isStall: false,
        cycleEntered: nextCycle
      };
      nextPipeline[0] = newInst;
      console.log(`Nueva instrucción ${newInst.index} entra en IF`);
    }
  }

  // Convertir el pipeline a lista de instrucciones activas
  const newInstructionStates = nextPipeline.filter(inst => inst !== null) as InstructionState[];
  
  // Guardar snapshot del pipeline
  const snapshot: PipelineSnapshot = {
    cycle: nextCycle,
    stages: [...nextPipeline],
    forwardingPaths: newForwardingPaths,
    stallsInserted: newStallsThisCycle
  };

  // Verificar si la simulación terminó
  const hasActiveInstructions = newInstructionStates.some(inst => !inst.isStall);
  const allInstructionsFetched = currentState.nextInstructionToFetch >= currentState.instructions.length;
  const pipelineEmpty = newInstructionStates.length === 0 || 
                       newInstructionStates.every(inst => inst.isStall);
  const isFinished = allInstructionsFetched && pipelineEmpty;

  // Logging para debug
  console.log("Pipeline en ciclo", nextCycle, ":");
  STAGE_NAMES.forEach((stage, idx) => {
    const inst = nextPipeline[idx];
    if (inst) {
      console.log(`  ${stage}: Inst ${inst.index} (${inst.hex})${inst.isStall ? ' [BUBBLE]' : ''}`);
    } else {
      console.log(`  ${stage}: ---`);
    }
  });

  return {
    ...currentState,
    currentCycle: nextCycle,
    instructionStates: newInstructionStates,
    forwardingPaths: newForwardingPaths,
    stallsThisCycle: newStallsThisCycle,
    pipelineHistory: [...currentState.pipelineHistory, snapshot],
    nextInstructionToFetch: needsStall ? currentState.nextInstructionToFetch : 
                           (currentState.nextInstructionToFetch + (nextPipeline[0] && 
                            !currentPipeline[0] ? 1 : 0)),
    totalStallsInserted: currentState.totalStallsInserted + (needsStall ? 1 : 0),
    isFinished,
    isRunning: !isFinished,
    maxCycles: isFinished ? nextCycle : currentState.maxCycles
  };
};

// El resto del componente permanece igual...
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

    const decodedInstructions = submittedInstructions.map(hex => decodeMIPSInstruction(hex));
    const estimatedMaxCycles = submittedInstructions.length + DEFAULT_STAGE_COUNT + 10;

    setSimulationState({
      ...initialState,
      instructions: submittedInstructions,
      decodedInstructions,
      instructionStates: [],
      currentCycle: 0,
      maxCycles: estimatedMaxCycles,
      isRunning: true,
      stallsEnabled: simulationState.stallsEnabled,
      forwardingEnabled: simulationState.forwardingEnabled,
      pipelineHistory: [],
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