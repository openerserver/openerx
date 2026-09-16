import { forwardRef, useLayoutEffect, useState } from "react";
import { StyleSheet, TextInput, type TextInputProps, useWindowDimensions } from "react-native";

type Props = Omit<TextInputProps, "multiline" | "numberOfLines" | "scrollEnabled"> & {
  value: string;
};

/** One line when empty; native text measurement handles wrapping on iOS and Android. */
export const ComposerInput = forwardRef<TextInput, Props>(
  ({ value, style, onContentSizeChange, ...props }, ref) => {
    const { fontScale } = useWindowDimensions();
    const inputStyle = StyleSheet.flatten(style);
    const borders =
      (inputStyle?.borderTopWidth ?? inputStyle?.borderWidth ?? 0) +
      (inputStyle?.borderBottomWidth ?? inputStyle?.borderWidth ?? 0);
    const minimum = Math.ceil(24 * fontScale + 20 + borders);
    const maximum = Math.ceil(24 * fontScale * 6 + 20 + borders);
    const [measured, setMeasured] = useState(minimum);
    const height = value.length ? Math.max(minimum, Math.min(maximum, measured)) : minimum;

    useLayoutEffect(() => {
      if (!value.length) setMeasured(minimum);
    }, [value, minimum]);

    return (
      <TextInput
        {...props}
        ref={ref}
        value={value}
        multiline
        underlineColorAndroid="transparent"
        scrollEnabled={value.length > 0 && measured > maximum}
        onContentSizeChange={(event) => {
          const next = Math.ceil(event.nativeEvent.contentSize.height + borders);
          if (Number.isFinite(next) && next > 0) {
            setMeasured(value.length ? next : minimum);
          }
          onContentSizeChange?.(event);
        }}
        style={[style, styles.input, { height, minHeight: minimum, maxHeight: maximum }]}
      />
    );
  },
);
ComposerInput.displayName = "ComposerInput";

const styles = StyleSheet.create({
  input: {
    fontSize: 16,
    lineHeight: 24,
    paddingTop: 10,
    paddingBottom: 10,
    includeFontPadding: false,
    textAlignVertical: "top",
  },
});
