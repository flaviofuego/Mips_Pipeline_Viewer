import { cn } from '@/lib/utils';


// Componente para mostrar paths de forwarding como flechas
interface ForwardingArrowProps {
  fromStage: string;
  toStage: string;
  register: number;
  className?: string;
}

function ForwardingArrow({ fromStage, toStage, register, className }: ForwardingArrowProps) {
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
}

export default ForwardingArrow