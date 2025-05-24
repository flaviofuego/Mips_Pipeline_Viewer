MIPS Visual Simulator Pipeline


A javascript based MIPS simulator that can simulate the MIPS assembly code. 

To run on dev mode, run the following command
```bash
 cd app
 nmp install
 npm run dev 
```

To deply the app, run the following command
```bash
 docker build -t mipspipelinei .
 docker run -d -it -p 5031:3000 --restart unless-stopped --name mipspipeline mipspipelinei