import * as React from "react";
import type { ReactNode } from "react";
import { ProjectorEvents, ProjectorPlugin } from "./projectorPlugin";

interface DisplayerProps {
}
interface DisplayerState {
}

export class ProjectorDisplayer extends React.Component<DisplayerProps, DisplayerState> {
    static instance?: ProjectorDisplayer;
    public containerRef: HTMLDivElement | null = null;
    public taskUuid: string | undefined;

    public constructor(props: DisplayerProps) {
        super(props);
        ProjectorPlugin._emitter.on(ProjectorEvents.EnableClick, () => {
            if (this.containerRef) {
                console.log("enabel click");
                this.containerRef.style.pointerEvents = "auto";
            }
        });
        ProjectorPlugin._emitter.on(ProjectorEvents.DisableClick, () => {
            if (this.containerRef) {
                console.log("disable click");
                this.containerRef!.style.pointerEvents = "none";
            }
        });
    }

    componentDidMount(): void {
        ProjectorPlugin._emitter.emit(ProjectorEvents.DisplayerDidMount, this);
        ProjectorDisplayer.instance = this;
        console.log("[Projector plugin] init displayer done");
    }

    render(): ReactNode {
        // {this.props.children} is whiteboard
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
