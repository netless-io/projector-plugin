import * as React from "react";
import type { ReactNode } from "react";

export interface DisplayerProps {
}
export interface DisplayerState {
}

export class ProjectorDisplayer extends React.Component<DisplayerProps, DisplayerState> {
    static instance: ProjectorDisplayer | null = null;
    public containerRef: HTMLDivElement | null = null;
    public taskUuid: string | undefined;

    componentDidMount(): void {
        ProjectorDisplayer.instance = this;
        console.log("[Projector plugin] init displayer done");
    }

    render(): ReactNode {
        return (
            <div id="projector-frame" style={{
                height: 400,
                width: 400,
            }}>
                <div ref={(ref) => this.containerRef = ref} style={{
                    height: 300,
                    width: 300,
                }}></div>
            </div>
            
        );
    }
}
