/** An AI failure with a message people can act on, and the HTTP status to send it with. */
export class AIError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'AIError';
  }
}
