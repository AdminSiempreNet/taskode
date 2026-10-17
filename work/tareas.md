## Tareas

Se requiere implementar funcionalidades para uso compartido real, pues hasta el momento la aplicación no tiene realmente funcionalidades de uso compartido.


1. Las tareas tienen un usuario responsable directo (por defecto el autor pero al crearla se puede definir el responsable) y pueden tener varios colaboradores, es decir con aquellos a los que se les comparte la tarea.  

2. Un usuario que no es responsable ni colaborador no puede ver ni modificar la tarea, excepto que sea administrador o propietario de la feature, el modulo o el proyecto. En otras palabras.

3. Todas las vistas de tareas, ahora deben incluir un filtro por usuario, similar al filtro de estados, con seleccion múltiple y con una opción "Mías" seleccionada por defecto.

4. La tarea ahora debe permitir adjuntar documentos, en la vista de edición un nuevo tab que permite adjuntar documentos como word, excel, pdf, imagenes, con un tamaño máximo de 10MB pero configurable en las opciones generales de la configuración. 

5. En la descripción y en los comentarios, debe ser posible pegar imagenes con el foco en el editor al usar ctrl+v se debe pegar una imagen como parte del contenido, pero el archivo se debe cargar al respectivo almacenamiento, es decir que no es base64. De la misma forma si pego un link de youtube debe renderizar mostrar el video. En el caso de los seguimientos debe ser similar a como se ve en whatsapp web.

