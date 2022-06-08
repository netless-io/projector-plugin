import * as React from "react";
import type { ReactNode } from "react";
import { ProjectorEvents, ProjectorPlugin } from "./projectorPlugin";

export interface DisplayerProps {
}
export interface DisplayerState {
}

export class ProjectorDisplayer extends React.Component<DisplayerProps, DisplayerState> {
    static instance: ProjectorDisplayer | null = null;
    public containerRef: HTMLDivElement | null = null;
    public taskUuid: string | undefined;

    public constructor(props: DisplayerProps) {
        super(props);
        ProjectorPlugin.emitter.on(ProjectorEvents.UpdateParentContainerRect, () => {
            if (this.containerRef) {
                const parent = this.containerRef.parentElement;
                if (parent) {
                    const rect = parent.getBoundingClientRect();
                    ProjectorPlugin.emitter.emit(ProjectorEvents.SetParentContainerRect, rect);
                }
            }
        });
        ProjectorPlugin.emitter.on(ProjectorEvents.EnableClick, () => {
            if (this.containerRef) {
                this.containerRef.style.pointerEvents = "auto";
            }
        });
        ProjectorPlugin.emitter.on(ProjectorEvents.DisableClick, () => {
            if (this.containerRef) {
                this.containerRef!.style.pointerEvents = "none";
            }
        });
    }

    componentDidMount(): void {
        ProjectorPlugin.emitter.emit(ProjectorEvents.DisplayerDidMount);
        ProjectorDisplayer.instance = this;
        console.log("[Projector plugin] init displayer done");
    }

    render(): ReactNode {
        // {this.props.children} 就是白板对象
        return (
            <React.Fragment>
                {this.props.children}
                <div id="projector-plugin"
                    style={{position: "absolute"}}
                    ref={(ref) => this.containerRef = ref}>
                </div>
            </React.Fragment>
        );
    }
}
