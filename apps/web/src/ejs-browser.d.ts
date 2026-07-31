declare module "ejs" {
  type RenderOptions = {
    async?: boolean;
    filename?: string;
  };

  const ejs: {
    render(
      template: string,
      data?: Record<string, unknown>,
      options?: RenderOptions,
    ): Promise<string>;
  };

  export default ejs;
}
