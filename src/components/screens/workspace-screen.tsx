import { lazy, Suspense } from "react";
import { useNavigationStore } from "@/store/navigation.store";
import { useAuthStore } from "@/store/auth.store";
import { ErrorBoundary } from "@/app/error-boundary";
const Operators=lazy(()=>import("./operators-screen").then(m=>({default:m.OperatorsScreen})));
const Settings=lazy(()=>import("./settings-screen").then(m=>({default:m.SettingsScreen})));
const Queue=lazy(()=>import("./queue-screen").then(m=>({default:m.QueueScreen})));
const Visitors=lazy(()=>import("./visitors-screen").then(m=>({default:m.VisitorsScreen})));
const Widget=lazy(()=>import("./widget-settings-screen").then(m=>({default:m.WidgetSettingsScreen})));
const Templates=lazy(()=>import("./templates-screen").then(m=>({default:m.TemplatesScreen})));
const Dashboard=lazy(()=>import("./dashboard-screen").then(m=>({default:m.DashboardScreen})));
const Logs=lazy(()=>import("@/pages/LogsPage"));
export function WorkspaceScreen({screen:requested}:{screen?:string}={}) {
  const current=useNavigationStore(state=>state.screen), role=useAuthStore(state=>state.operator?.role);
  const screen=requested||current;
  const protectedScreen=["dashboard","widget_settings"].includes(screen);
  if(protectedScreen&&!['admin','supervisor'].includes(role||''))return <p style={{padding:24}}>Этот раздел доступен руководителю команды.</p>;
  return <ErrorBoundary key={screen}><Suspense fallback={<p role="status" style={{padding:24,color:'var(--text-muted)'}}>Загружаем раздел…</p>}>
    {screen==="operators"?<Operators/>:screen==="settings"?<Settings/>:screen==="queue"?<Queue/>:screen==="visitors"?<Visitors/>:screen==="widget_settings"?<Widget/>:screen==="templates"?<Templates/>:screen==="dashboard"?<Dashboard/>:screen==="logs"?<Logs/>:null}
  </Suspense></ErrorBoundary>;
}
