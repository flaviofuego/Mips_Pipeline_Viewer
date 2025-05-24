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
  const simulationHistory: PipelineSnapshot[] = [];
  let currentCycle = 0;
  let nextInstructionToFetch = 0;
  let totalStallsInserted = 0;
  
  // Estado inicial del pipeline (5 etapas vacías)
  let currentPipeline: (InstructionState | null)[] = new Array(5).fill(null);
  
  // Continuar hasta que todas las instrucciones hayan pasado por el pipeline
  while (true) {
    currentCycle++;
    
    const newForwardingPaths: ForwardingPath[] = [];
    const newStallsThisCycle: number[] = [];
    
    // Detectar hazards
    let needsStall = false;
    const instInIF = currentPipeline[0];
    const instInID = currentPipeline[1];
    const instInEX = currentPipeline[2];
    const instInMEM = currentPipeline[3];
    const instInWB = currentPipeline[4];

    if (stallsEnabled && instInID) {
      // Verificar hazard con instrucción en EX
      if (instInEX && hasRAWHazard(instInEX.decoded, instInID.decoded)) {
        if (forwardingEnabled && canForward(instInEX.decoded, instInID.decoded, 1)) {
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
        } else if (forwardingEnabled && canForward(instInMEM.decoded, instInID.decoded, 2)) {
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
      if (instInIF) nextPipeline[0] = { ...instInIF };
      if (instInID) nextPipeline[1] = { ...instInID };
      
      
      // Insertar bubble en EX
      const bubble: InstructionState = {
        index: -1000 - currentCycle,
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
        cycleEntered: currentCycle
      };
      nextPipeline[2] = bubble;
      newStallsThisCycle.push(bubble.index);
      totalStallsInserted++;
      
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
      if (!nextPipeline[0] && nextInstructionToFetch < instructions.length) {
        const newInst: InstructionState = {
          index: nextInstructionToFetch,
          hex: instructions[nextInstructionToFetch],
          decoded: decodedInstructions[nextInstructionToFetch],
          currentStage: 0,
          isStall: false,
          cycleEntered: currentCycle
        };
        nextPipeline[0] = newInst;
        nextInstructionToFetch++;
      }
    }

    // Guardar snapshot del pipeline
    const snapshot: PipelineSnapshot = {
      cycle: currentCycle,
      stages: [...nextPipeline],
      forwardingPaths: newForwardingPaths,
      stallsInserted: newStallsThisCycle
    };
    simulationHistory.push(snapshot);

    // Actualizar pipeline para el siguiente ciclo
    currentPipeline = nextPipeline;

    // Verificar si la simulación terminó
    const allInstructionsFetched = nextInstructionToFetch >= instructions.length;
    const pipelineEmpty = nextPipeline.every(inst => inst === null || inst.isStall);
    
    if (allInstructionsFetched && pipelineEmpty) {
      console.log(`📊 Total de stalls insertados: ${totalStallsInserted}`);
      break;
    }

    // Logging para debug
    console.log("Pipeline en ciclo", currentCycle, ":");
    STAGE_NAMES.forEach((stage, idx) => {
      const inst = nextPipeline[idx];
      if (inst) {
        console.log(`  ${stage}: Inst ${inst.index} (${inst.hex})${inst.isStall ? ' [BUBBLE]' : ''}`);
      } else {
        console.log(`  ${stage}: ---`);
      }
    });
  }
  
  return simulationHistory;
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