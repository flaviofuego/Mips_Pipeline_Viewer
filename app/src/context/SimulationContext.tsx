// src/context/SimulationContext.tsx
"use client";

import type { PropsWithChildren } from 'react';
import * as React from 'react';
import { decodeMIPSInstruction, hasRAWHazard, canForward, calculateStallsNeeded, type DecodedInstruction } from '@/lib/mips-decoder';

// Define the stage names
const STAGE_NAMES = ['IF', 'ID', 'EX', 'MEM', 'WB'] as const;
type StageName = typeof STAGE_NAMES[number];

// Forwarding path representation
export interface ForwardingPath {
  from: { instructionIndex: number; stage: number };
  to: { instructionIndex: number; stage: number };
  register: number;
}

// Enhanced instruction state
export interface InstructionState {
  index: number;
  hex: string;
  decoded: DecodedInstruction;
  currentStage: number | null; // 0-4 for stages, null if not in pipeline
  isStall: boolean; // Si esta instrucción es un bubble/stall
  stallsInserted: number; // Número de stalls insertados antes de esta instrucción
}

// Define the shape of the context state
interface SimulationState {
  instructions: string[];
  decodedInstructions: DecodedInstruction[];
  instructionStates: InstructionState[];
  currentCycle: number;
  maxCycles: number;
  isRunning: boolean;
  stageCount: number;
  isFinished: boolean;

  // Hazard handling options
  stallsEnabled: boolean;
  forwardingEnabled: boolean;

  // Visual information
  forwardingPaths: ForwardingPath[]; // Paths activos en el ciclo actual
  stallsThisCycle: number[]; // Instrucciones que son stalls en este ciclo
}

// Define the shape of the context actions
interface SimulationActions {
  startSimulation: (submittedInstructions: string[]) => void;
  resetSimulation: () => void;
  pauseSimulation: () => void;
  resumeSimulation: () => void;
  setStallsEnabled: (enabled: boolean) => void;
  setForwardingEnabled: (enabled: boolean) => void;
}

// Create the contexts
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
};

/**
 * Calcula el siguiente estado de la simulación
 * 
 * Esta función implementa la lógica correcta de pipeline con manejo de hazards.
 * Los stalls funcionan pausando instrucciones específicas, no creando bubbles infinitas.
 */
const calculateNextState = (currentState: SimulationState): SimulationState => {
  console.log(`----------- CICLO ${currentState.currentCycle + 1} -----------`);
  console.log('Estado actual del pipeline:',
    currentState.instructionStates.map(i =>
      `Inst ${i.index} (${i.hex}): Etapa ${i.currentStage !== null ? STAGE_NAMES[i.currentStage] : 'COMPLETA'}`
    )
  );


  if (!currentState.isRunning || currentState.isFinished) {
    return currentState;
  }

  const nextCycle = currentState.currentCycle + 1;

  // Crear una representación simple del pipeline para este ciclo
  // Cada posición representa qué instrucción está en qué etapa
  const pipelineState: { [stage: number]: InstructionState | null } = {
    0: null, // IF
    1: null, // ID  
    2: null, // EX
    3: null, // MEM
    4: null  // WB
  };

  // Llenar el estado actual del pipeline
  currentState.instructionStates.forEach(inst => {
    if (inst.currentStage !== null && !inst.isStall) {
      pipelineState[inst.currentStage] = inst;
    }
  });

  // Generar una tabla para visualizar mejor el estado del pipeline
  const pipelineTable = STAGE_NAMES.map(stage => {
    const stageIndex = STAGE_NAMES.indexOf(stage);
    const inst = pipelineState[stageIndex];
    return {
      Stage: stage,
      Instruction: inst ? `${inst.hex} (Inst ${inst.index + 1})` : '---',
      isStall: inst ? inst.isStall : false
    };
  });
  console.table(pipelineTable);

  // Detectar si hay hazards que requieren stalls
  let needsStall = false;
  const forwardingPaths: ForwardingPath[] = [];

  if (currentState.stallsEnabled) {
    // Revisar hazards entre instrucciones en ID y EX/MEM
    const instInID = pipelineState[1]; // Instrucción en ID
    const instInEX = pipelineState[2]; // Instrucción en EX
    const instInMEM = pipelineState[3]; // Instrucción en MEM

    if (instInID) {
      // Revisar hazard con instrucción en EX
      if (instInEX && hasRAWHazard(instInEX.decoded, instInID.decoded)) {
        console.log(`HAZARD DETECTADO: Entre instrucción ${instInEX.index} (${instInEX.hex}) en EX y ${instInID.index} (${instInID.hex}) en ID`);
        console.log('Registros en conflicto:', instInEX.decoded.writesTo.filter(reg =>
          instInID.decoded.readsFrom.includes(reg)
        ));

        if (currentState.forwardingEnabled && canForward(instInEX.decoded, instInID.decoded, 1)) {
          // Puede resolverse con forwarding
          console.log('✅ Se resuelve con forwarding');
          const sharedRegisters = instInEX.decoded.writesTo.filter(reg =>
            instInID.decoded.readsFrom.includes(reg)
          );
          sharedRegisters.forEach(reg => {
            forwardingPaths.push({
              from: { instructionIndex: instInEX.index, stage: 2 },
              to: { instructionIndex: instInID.index, stage: 1 },
              register: reg
            });
          });
        } else {
          // Necesita stall
          needsStall = true;
        }
      }

      // Revisar hazard con instrucción en MEM (load-use hazard)
      if (instInMEM && hasRAWHazard(instInMEM.decoded, instInID.decoded)) {
        if (instInMEM.decoded.isLoad) {
          // Load-use hazard: siempre necesita stall
          needsStall = true;
        } else if (currentState.forwardingEnabled && canForward(instInMEM.decoded, instInID.decoded, 2)) {
          // Puede resolverse con forwarding
          const sharedRegisters = instInMEM.decoded.writesTo.filter(reg =>
            instInID.decoded.readsFrom.includes(reg)
          );
          sharedRegisters.forEach(reg => {
            forwardingPaths.push({
              from: { instructionIndex: instInMEM.index, stage: 3 },
              to: { instructionIndex: instInID.index, stage: 1 },
              register: reg
            });
          });
        } else {
          needsStall = true;
        }
      }
    }
  }

  // Crear el nuevo estado de instrucciones
  const newInstructionStates: InstructionState[] = [];

  if (needsStall) {
    console.log('🛑 STALL NECESARIO: Insertando bubble en EX');

    // STALL: las instrucciones en IF e ID se quedan donde están
    // Las instrucciones en EX, MEM, WB avanzan normalmente

    // Avanzar instrucciones en etapas posteriores (EX, MEM, WB)
    [2, 3, 4].forEach(stage => {
      const inst = pipelineState[stage];
      if (inst) {
        const newInst = { ...inst };
        newInst.currentStage = stage + 1;
        if (newInst.currentStage >= currentState.stageCount) {
          newInst.currentStage = null; // Sale del pipeline
        }
        if (newInst.currentStage !== null) {
          newInstructionStates.push(newInst);
        }
      }
    });

    // Las instrucciones en IF e ID se mantienen en su lugar (stall)
    [0, 1].forEach(stage => {
      const inst = pipelineState[stage];
      if (inst) {
        const newInst = { ...inst };
        // No cambia currentStage - se queda en la misma etapa
        newInstructionStates.push(newInst);
      }
    });

    // Insertar un bubble en EX (donde habría avanzado la instrucción de ID)
    const bubbleInstruction: InstructionState = {
      index: -nextCycle, // Índice único para este bubble
      hex: 'BUBBLE',
      decoded: {
        hex: 'BUBBLE',
        opcode: -1,
        type: 'R',
        isLoad: false,
        isStore: false,
        readsFrom: [],
        writesTo: []
      },
      currentStage: 2, // Bubble en EX
      isStall: true,
      stallsInserted: 0
    };
    newInstructionStates.push(bubbleInstruction);

  } else {
    console.log('✅ AVANCE NORMAL: Todas las instrucciones avanzan');

    // AVANCE NORMAL: todas las instrucciones avanzan una etapa
    Object.values(pipelineState).forEach(inst => {
      if (inst && !inst.isStall) {
        const newInst = { ...inst };
        newInst.currentStage = (newInst.currentStage || 0) + 1;
        if (newInst.currentStage >= currentState.stageCount) {
          newInst.currentStage = null; // Sale del pipeline
        }
        if (newInst.currentStage !== null) {
          newInstructionStates.push(newInst);
        }
      }
    });

    // Introducir nueva instrucción en IF si hay más instrucciones disponibles
    const nextInstructionIndex = Math.floor((nextCycle - 1) -
      currentState.instructionStates.filter(inst => inst.isStall).length);

    if (nextInstructionIndex < currentState.decodedInstructions.length && !pipelineState[0]) {
      const newInstruction: InstructionState = {
        index: nextInstructionIndex,
        hex: currentState.instructions[nextInstructionIndex],
        decoded: currentState.decodedInstructions[nextInstructionIndex],
        currentStage: 0, // Entra en IF
        isStall: false,
        stallsInserted: 0
      };
      newInstructionStates.push(newInstruction);
    }
  }

  // Determinar si la simulación ha terminado
  const remainingInstructions = newInstructionStates.filter(inst => !inst.isStall);
  const allInstructionsProcessed = remainingInstructions.length === 0 &&
    nextCycle > currentState.instructions.length + currentState.stageCount + 2;


  console.log('Nuevo estado:', newInstructionStates.map(i =>
    `Inst ${i.index} (${i.hex}): Etapa ${i.currentStage !== null ? STAGE_NAMES[i.currentStage] : 'COMPLETA'}${i.isStall ? ' [BUBBLE]' : ''}`
  ));
  console.log(`Forwarding Paths: ${forwardingPaths.length}`);
  console.log('----------------------------------------');

  return {
    ...currentState,
    currentCycle: nextCycle,
    instructionStates: newInstructionStates,
    isFinished: allInstructionsProcessed,
    isRunning: !allInstructionsProcessed,
    forwardingPaths,
    stallsThisCycle: newInstructionStates.filter(inst => inst.isStall).map(inst => inst.index)
  };


};

// Create the provider component
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
    }, 1500); // Un poco más lento para observar mejor los hazards
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

    // Decodificar todas las instrucciones
    const decodedInstructions = submittedInstructions.map(hex => decodeMIPSInstruction(hex));

    // Calcular máximo de ciclos (estimación considerando posibles stalls)
    const estimatedMaxCycles = submittedInstructions.length + DEFAULT_STAGE_COUNT +
      (simulationState.stallsEnabled ? Math.floor(submittedInstructions.length / 2) : 0);

    // Crear estado inicial de instrucciones
    const initialInstructionStates: InstructionState[] = [{
      index: 0,
      hex: submittedInstructions[0],
      decoded: decodedInstructions[0],
      currentStage: 0, // Empieza en IF
      isStall: false,
      stallsInserted: 0
    }];

    setSimulationState({
      ...initialState,
      instructions: submittedInstructions,
      decodedInstructions,
      instructionStates: initialInstructionStates,
      currentCycle: 1,
      maxCycles: estimatedMaxCycles,
      isRunning: true,
      stallsEnabled: simulationState.stallsEnabled,
      forwardingEnabled: simulationState.forwardingEnabled,
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
      // Si activamos forwarding, automáticamente activamos stalls
      stallsEnabled: enabled || prev.stallsEnabled
    }));
  };

  // Effect to manage the interval timer
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

// Custom hooks for easy context consumption
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