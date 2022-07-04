export enum ProjectorErrorType {
    StatusError = "StatusError",
    ResourceError = "ResourceError",
    RuntimeError = "RuntimeError",
}

export class ProjectorError extends Error {
    readonly type: ProjectorErrorType;
    constructor(message: string, type: ProjectorErrorType) {
        super(message);
        this.type = type;

        Object.setPrototypeOf(this, ProjectorError.prototype);
        console.error(message);
    }
}