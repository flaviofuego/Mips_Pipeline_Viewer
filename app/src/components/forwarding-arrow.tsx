import { cn } from '@/lib/utils';

// Mapeo de nombres de etapas a posiciones relativas
const STAGE_POSITIONS: Record<string, number> = {
  'IF': 0,
  'ID': 1,
  'EX': 2,
  'MEM': 3,
  'WB': 4
};

// Componente para mostrar paths de forwarding como flechas
interface ForwardingArrowProps {
  fromStage: string;
  toStage: string;
  register: number;
  fromInstructionIndex: number;
  toInstructionIndex: number;
  cycle: number;
  className?: string;
}

function ForwardingArrow({ 
  fromStage, 
  toStage, 
  register, 
  fromInstructionIndex,
  toInstructionIndex,
  cycle,
  className 
}: ForwardingArrowProps) {
  // Calcular la posición relativa de las etapas
  const fromPos = STAGE_POSITIONS[fromStage] || 0;
  const toPos = STAGE_POSITIONS[toStage] || 0;
  
  // Determinar si la flecha va hacia adelante o hacia atrás
  const isForward = fromPos < toPos;
  
  // Calcular la dirección y longitud de la flecha
  const arrowWidth = Math.abs(toPos - fromPos) * 25; // 25% por cada etapa de diferencia
  
  return (
    <div 
      className={cn(
        "absolute pointer-events-none z-30", 
        className,
        // Ajustar la posición vertical según la relación entre instrucciones
        fromInstructionIndex === toInstructionIndex 
          ? "top-1/2 -translate-y-1/2" 
          : fromInstructionIndex < toInstructionIndex
            ? "top-[80%]"
            : "top-[20%]"
      )}
      style={{
        // Posicionamiento horizontal basado en las etapas
        left: `${(fromPos * 20) + 10}%`,
        width: `${arrowWidth}%`
      }}
    >
      <div className="relative w-full">
        {/* Línea de la flecha */}
        <div className={cn(
          "absolute h-1 bg-purple-500",
          isForward ? "left-0 right-0" : "right-full w-[100px]"
        )}>
          {/* Punta de la flecha */}
          <div className={cn(
            "absolute top-1/2 -translate-y-1/2 w-0 h-0 border-solid border-y-4 border-y-transparent",
            isForward 
              ? "right-0 border-l-8 border-l-purple-500" 
              : "left-0 border-r-8 border-r-purple-500"
          )} />
        </div>
        
        {/* Etiqueta del registro */}
        <div className="absolute -top-6 left-1/2 transform -translate-x-1/2 bg-purple-500 text-white text-xs px-2 py-0.5 rounded-full shadow-sm">
          R{register}
        </div>
      </div>
    </div>
  );
}

export default ForwardingArrow;