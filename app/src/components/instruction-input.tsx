// src/components/instruction-input.tsx
"use client";

import type * as React from 'react';
import { useState, useEffect } from 'react';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { useSimulationActions, useSimulationState } from '@/context/SimulationContext';
import { Play, Pause, RotateCcw, AlertTriangle, Zap } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface InstructionInputProps {
  onInstructionsSubmit: (instructions: string[]) => void;
  onReset: () => void;
  isRunning: boolean;
}

const HEX_REGEX = /^[0-9a-fA-F]{8}$/;

export function InstructionInput({ onInstructionsSubmit, onReset, isRunning }: InstructionInputProps) {
  const [inputText, setInputText] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  
  const { pauseSimulation, resumeSimulation, setStallsEnabled, setForwardingEnabled } = useSimulationActions();
  const { 
    currentCycle, 
    isFinished, 
    instructions, 
    stallsEnabled, 
    forwardingEnabled,
    forwardingPaths,
    stallsThisCycle 
  } = useSimulationState();

  // Reset input text when instructions are cleared
  useEffect(() => {
    if (instructions.length === 0) {
      setInputText('');
      setError(null);
    }
  }, [instructions]);

  const hasStarted = currentCycle > 0;
  const canPauseResume = hasStarted && !isFinished;
  const disableInputAndStart = hasStarted && !isFinished;

  const handleSubmit = () => {
    setError(null);
    const lines = inputText.trim().split('\n');
    const currentInstructions = lines
      .map(line => line.trim())
      .filter(line => line.length > 0);

    if (currentInstructions.length === 0) {
      setError('Por favor ingresa al menos una instrucción MIPS en formato hexadecimal.');
      return;
    }

    const invalidInstructions = currentInstructions.filter(inst => !HEX_REGEX.test(inst));
    if (invalidInstructions.length > 0) {
      setError(`Formato de instrucción inválido encontrado: ${invalidInstructions.join(', ')}. Cada instrucción debe tener 8 caracteres hexadecimales.`);
      return;
    }

    onInstructionsSubmit(currentInstructions);
  };

  const handlePauseResume = () => {
    if (isRunning) {
      pauseSimulation();
    } else {
      resumeSimulation();
    }
  };

  const handleStallsToggle = (checked: boolean) => {
    if (hasStarted) return; // No permitir cambios durante la simulación
    setStallsEnabled(checked);
  };

  const handleForwardingToggle = (checked: boolean) => {
    if (hasStarted) return; // No permitir cambios durante la simulación
    setForwardingEnabled(checked);
  };

  // Sample instructions para demostrar hazards
  const loadSampleHazards = () => {
    const sampleInstructions = [
      '8C020000', // lw $v0, 0($zero)     - Load word
      '00422020', // add $a0, $v0, $v0    - Usa el resultado del load (hazard!)
      '00442820', // add $a1, $v0, $a0    - Otro uso del registro
      '20630001', // addi $v1, $v1, 1     - Instrucción independiente
    ].join('\n');
    setInputText(sampleInstructions);
  };

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          MIPS Instructions
          {hasStarted && (
            <div className="flex gap-1">
              {stallsEnabled && (
                <Badge variant="outline" className="text-xs">
                  <AlertTriangle className="w-3 h-3 mr-1" />
                  Stalls
                </Badge>
              )}
              {forwardingEnabled && (
                <Badge variant="outline" className="text-xs">
                  <Zap className="w-3 h-3 mr-1" />
                  Forwarding
                </Badge>
              )}
            </div>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Hazard Control Options */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="stalls-switch" className="text-sm font-medium">
                Detectar Hazard
              </Label>
              <p className="text-xs text-muted-foreground">
                Pausa el pipeline cuando detecta hazards de datos
              </p>
            </div>
            <Switch
              id="stalls-switch"
              checked={stallsEnabled}
              onCheckedChange={handleStallsToggle}
              disabled={hasStarted}
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="forwarding-switch" className="text-sm font-medium">
                Habilitar Forwarding
              </Label>
              <p className="text-xs text-muted-foreground">
                Adelanta resultados para evitar stalls cuando es posible
              </p>
            </div>
            <Switch
              id="forwarding-switch"
              checked={forwardingEnabled}
              onCheckedChange={handleForwardingToggle}
              disabled={hasStarted}
            />
          </div>

          {forwardingEnabled && !stallsEnabled && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription className="text-xs">
                El forwarding requiere la detección de stalls para los hazards load-use.
              </AlertDescription>
            </Alert>
          )}
        </div>

        <Separator />

        {/* Instruction Input */}
        <div className="grid w-full gap-1.5">
          <div className="flex justify-between items-center">
            <Label htmlFor="instructions">Instrucciones Hex (una por línea)</Label>
            <Button
              variant="outline"
              size="sm"
              onClick={loadSampleHazards}
              disabled={hasStarted}
              className="text-xs"
            >
              Cargar Ejemplo
            </Button>
          </div>
          <Textarea
            id="instructions"
            placeholder="e.g., 8C020000"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            rows={5}
            className="font-mono text-sm"
            disabled={disableInputAndStart}
            aria-label="MIPS Hex Instructions Input"
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        {/* Current State Information */}
        {hasStarted && (
          <div className="space-y-2 p-3 bg-muted/50 rounded-md">
            <div className="text-sm">
              <strong>Estado actual:</strong>
            </div>
            <div className="text-xs space-y-1">
              {forwardingPaths.length > 0 && (
                <div className="flex items-center gap-1 text-blue-600">
                  <Zap className="w-3 h-3" />
                  {forwardingPaths.length} path(s) de forwarding activos
                </div>
              )}
              {stallsThisCycle.length > 0 && (
                <div className="flex items-center gap-1 text-orange-600">
                  <AlertTriangle className="w-3 h-3" />
                  {stallsThisCycle.length} stall(s) insertados
                </div>
              )}
              {forwardingPaths.length === 0 && stallsThisCycle.length === 0 && (
                <div className="text-green-600">Sin hazards detectados</div>
              )}
            </div>
          </div>
        )}

        {/* Control Buttons */}
        <div className="flex justify-between items-center gap-2">
          <Button onClick={handleSubmit} disabled={disableInputAndStart} className="flex-1">
            {isFinished ? 'Finalizado' : hasStarted ? 'Ejecutando...' : 'Iniciar Simulación'}
          </Button>

          {canPauseResume && (
            <Button variant="outline" onClick={handlePauseResume} size="icon" aria-label={isRunning ? 'Pausar Simulación' : 'Reanudar Simulación'}>
              {isRunning ? <Pause /> : <Play />}
            </Button>
          )}

          {hasStarted && (
            <Button variant="destructive" onClick={onReset} size="icon" aria-label="Reiniciar Simulación">
              <RotateCcw />
            </Button>
          )}
        </div>

        {/* Instructions Help */}
        {!hasStarted && (
          <div className="text-xs text-muted-foreground space-y-1">
            <p><strong>Ejemplos de hazards:</strong></p>
            <ul className="space-y-0.5 ml-4">
              <li>• <code>8C020000</code> seguido de <code>00422020</code> (load-use hazard)</li>
              <li>• <code>00221020</code> seguido de <code>00442820</code> (RAW hazard normal)</li>
              <li>• <code>20020005</code> seguido de <code>00422820</code> (puede usar forwarding)</li>
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}