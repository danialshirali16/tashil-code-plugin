import styled from 'styled-components';
import { Button } from './Button';

const CheckoutCardRoot = styled.section`
  display: flex;
  width: min(100%, 420px);
  flex-direction: column;
  gap: 24px;
  padding: 32px;
  border: 1px solid #d8e2ef;
  border-radius: 18px;
  background: #ffffff;
  box-shadow: 0 18px 45px rgba(13, 45, 82, 0.12);
`;

const SummaryRoot = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
`;

const Heading = styled.h1`
  margin: 0;
  color: #102a43;
  font-size: 24px;
`;

const Price = styled.strong`
  color: #0d70d9;
  font-size: 20px;
`;

export function CheckoutCard() {
  return (
    <CheckoutCardRoot>
      <SummaryRoot>
        <Heading>Order summary</Heading>
        <Price>$48.00</Price>
      </SummaryRoot>
      <Button fullWidth intent="primary" size="large">
        Continue to payment
      </Button>
    </CheckoutCardRoot>
  );
}

