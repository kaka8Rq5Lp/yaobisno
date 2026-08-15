# yaobisno

## Build do CSS (importante)
O site usa Tailwind, mas **não** depende do CDN em runtime (que falhava em telemóveis antigos).
O CSS é pré-compilado em `tailwind.css`. Sempre que adicionares classes novas aos HTML:

```
npm run build:css
```

`legacy.css` tem fallbacks para browsers antigos (gap, grid-gap, sticky, backdrop-blur) e não precisa de rebuild.